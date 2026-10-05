import { connect, type ChannelModel, type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import type { Namespace } from 'socket.io';
import type Redis from 'ioredis';
import { z } from 'zod';
const status = z.enum(['PENDING','ASSIGNMENT_PENDING','ASSIGNED','DECLINED','EXPIRED','REJECTED','REVOKED']);
export const eventSchema = z.object({ eventId: z.uuid(), type: z.enum(['DRIVER_TRIP_OFFER','DRIVER_TRIP_OFFER_UPDATED']), offerId: z.uuid(), tripId: z.uuid(), driverId: z.uuid(), version: z.number().int().positive(), status, expiresAt: z.iso.datetime() }).strict();
const offerSchema = z.object({ offerId: z.uuid(), tripId: z.uuid(), driverId: z.uuid(), version: z.number().int().positive(), status, expiresAt: z.iso.datetime(), pickup: z.object({ lat: z.number(), lng: z.number(), address: z.string().optional() }), destination: z.object({ lat: z.number(), lng: z.number(), address: z.string().optional() }), vehicleType: z.enum(['BIKE','CAR_4','CAR_7']), fare: z.object({ currency: z.literal('VND'), amount: z.string().regex(/^\d+$/) }) });
export type DriverOffer = z.infer<typeof offerSchema>;
export function canDeliver(o: DriverOffer, now: number) { return o.status !== 'PENDING' || now < Date.parse(o.expiresAt); }
const CACHE = `local old=redis.call('GET',KEYS[1]);if old then local data=cjson.decode(old);if tonumber(data.version)>=tonumber(ARGV[1]) then return 0 end end;redis.call('SET',KEYS[1],ARGV[2],'EX',604800);return 1`;
export class OfferConsumer {
  private server?: Namespace; private model?: ChannelModel; private channel?: ConfirmChannel; private timer?: NodeJS.Timeout; private connecting = false; private stopped = false;
  constructor(private readonly redis: Redis, private readonly config: { rabbitUrl: string; matchingUrl: string; matchingToken: string }) {}
  attach(server: Namespace) { this.server = server; }
  async lookup(path: string): Promise<DriverOffer | null> {
    const response = await fetch(this.config.matchingUrl + path, { redirect: 'error', signal: AbortSignal.timeout(3000), headers: { 'X-Service-Token': this.config.matchingToken } });
    if (response.status === 404) return null; if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('MATCHING_UNAVAILABLE'); }
    const chunks: Uint8Array[] = []; let bytes = 0; for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 65536) throw new Error('INVALID_OFFER'); chunks.push(chunk); }
    return z.object({ data: offerSchema.nullable() }).parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))).data;
  }
  async replay(driverId: string) {
    if (!this.config.rabbitUrl || !this.server) return;
    const offer = await this.lookup(`/internal/matching/drivers/${driverId}/offer`);
    if (offer && offer.driverId === driverId && ['PENDING','ASSIGNMENT_PENDING','ASSIGNED'].includes(offer.status) && canDeliver(offer, Date.now())) this.server.to('driver:' + driverId).emit(offer.status === 'PENDING' ? 'driver.trip.offer' : 'driver.trip.offer.updated', { data: offer });
  }
  async consume(message: ConsumeMessage, channel: ConfirmChannel) {
    if (message.content.length > 65536) { channel.nack(message, false, false); return; }
    let event: z.infer<typeof eventSchema>;
    try { event = eventSchema.parse(JSON.parse(message.content.toString('utf8'))); } catch { channel.nack(message, false, false); return; }
    try {
      if (!this.server) throw new Error('SOCKET_NOT_READY');
      const current = await this.lookup(`/internal/matching/offers/${event.offerId}`);
      if (!current || current.driverId !== event.driverId || current.tripId !== event.tripId) { channel.ack(message); return; }
      if (current.version < event.version) throw new Error('VERSION_NOT_VISIBLE');
      // Authoritative newer terminal supersedes late older messages. Duplicate never resets expiry.
      const changed = await this.redis.eval(CACHE, 1, 'realtime:offer:' + current.offerId, current.version, JSON.stringify(current));
      if (changed === 1 && canDeliver(current, Date.now())) this.server.to('driver:' + current.driverId).emit(current.status === 'PENDING' ? 'driver.trip.offer' : 'driver.trip.offer.updated', { data: current });
      channel.ack(message);
    } catch {
      const retries = Number(message.properties.headers?.['x-offer-retries'] ?? 0);
      if (!Number.isInteger(retries) || retries >= 10) { channel.nack(message, false, false); return; }
      const queue = 'driver.offers.retry.' + (retries === 0 ? 1000 : retries < 3 ? 10000 : 30000);
      await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('RETRY_CONFIRM_TIMEOUT')), 5000); channel.sendToQueue(queue, message.content, { persistent: true, contentType: 'application/json', messageId: message.properties.messageId, headers: { ...message.properties.headers, 'x-offer-retries': retries + 1 } }, error => { clearTimeout(timer); if (error) reject(error); else resolve(); }); });
      channel.ack(message);
    }
  }
  async start() {
    if (this.stopped || this.connecting || this.model || !this.config.rabbitUrl) return; this.connecting = true;
    try {
      const model = await connect(this.config.rabbitUrl, { timeout: 5000 }); this.model = model; model.on('error', () => {}); model.on('close', () => { if (this.model === model) { this.model = undefined; this.channel = undefined; } });
      const channel = await model.createConfirmChannel(); this.channel = channel; channel.on('error', () => {}); channel.on('close', () => { if (this.channel === channel) { this.channel = undefined; void model.close().catch(() => {}); } });
      await channel.assertExchange('matching.offers', 'direct', { durable: true }); await channel.assertExchange('matching.offers.dlx', 'direct', { durable: true });
      await channel.assertQueue('driver.offers.dlq', { durable: true }); await channel.bindQueue('driver.offers.dlq','matching.offers.dlx','dead');
      await channel.assertQueue('driver.offers', { durable: true, arguments: { 'x-dead-letter-exchange': 'matching.offers.dlx', 'x-dead-letter-routing-key': 'dead' } }); await channel.bindQueue('driver.offers','matching.offers','offer');
      for (const delay of [1000,10000,30000]) await channel.assertQueue(`driver.offers.retry.${delay}`, { durable: true, arguments: { 'x-message-ttl': delay, 'x-dead-letter-exchange': 'matching.offers', 'x-dead-letter-routing-key': 'offer' } });
      await channel.prefetch(16); await channel.consume('driver.offers', message => { if (message) void this.consume(message, channel).catch(() => { void model.close().catch(() => {}); }); }, { noAck: false });
    } catch { await this.model?.close().catch(() => {}); this.model = undefined; this.channel = undefined; }
    finally { this.connecting = false; }
  }
  onModuleInit() { this.timer = setInterval(() => { void this.start(); }, 2000); void this.start(); }
  async onModuleDestroy() { this.stopped = true; if (this.timer) clearInterval(this.timer); await this.model?.close().catch(() => {}); }
}
