import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../../bootstrap/config';
import { JsonHttpClient, TransportError } from '../clients/http';
import { MatchingClient } from '../clients/matching';
import { PgOutbox, type Delivery } from './repository';
import type { TripEventBus } from './bus';
import { recordDelivery, traced } from './metrics';
/** `accepts` false: the destination is not configured here, so its pending deliveries are skipped instead of sent. */
export interface DeliverySender { send(delivery: Delivery): Promise<void>; accepts?(destination: string): boolean }
export class HttpDeliverySender implements DeliverySender {
  private readonly matching: MatchingClient;
  private readonly targets: Record<string, JsonHttpClient>;
  /** `bus` publishes events to RabbitMQ (ADR-0002). Deliveries to a destination not configured here are skipped. */
  constructor(config: Config, private readonly bus?: TripEventBus) {
    this.targets = { matching: new JsonHttpClient(config.matchingUrl, config.matchingToken, config.httpTimeout), ...(config.gatewayUrl ? { gateway: new JsonHttpClient(config.gatewayUrl, config.gatewayToken, config.httpTimeout) } : {}), ...(config.notificationUrl ? { notification: new JsonHttpClient(config.notificationUrl, config.notificationToken, config.httpTimeout) } : {}) };
    this.matching = new MatchingClient(this.targets.matching!);
  }
  accepts(destination: string) { return destination === 'bus' ? !!this.bus : destination in this.targets; }
  async send(delivery: Delivery): Promise<void> {
    const requestId = randomUUID();
    if (delivery.kind !== 'event') { if (delivery.destination !== 'matching') throw new TransportError(false, 'INVALID_DESTINATION'); return this.matching.send(delivery.kind, delivery.payload, requestId); }
    if (delivery.destination === 'bus') { if (!this.bus) throw new TransportError(false, 'INVALID_DESTINATION'); return this.bus.publish(delivery.payload); }
    const ack = await this.targets[delivery.destination]!.post('/internal/events/trips', delivery.payload, requestId, z.object({ eventId: z.uuid(), accepted: z.literal(true) }).strict(), 202);
    if (ack.eventId !== delivery.payload.eventId) throw new TransportError(false, 'INVALID_ACK');
  }
}
export class OutboxDispatcher {
  lastProgress = 0;
  private active = false;
  constructor(private readonly repository: PgOutbox, private readonly sender: DeliverySender, private readonly config: Pick<Config, 'batchSize' | 'concurrency' | 'leaseMs' | 'retryBase' | 'retryMax'>) {}
  /** Runs one batch and returns how many deliveries were claimed (0 when a batch is already running). */
  async tick(): Promise<number> {
    if (this.active) return 0; this.active = true; const owner = randomUUID();
    let renewal: NodeJS.Timeout | undefined;
    try {
      const deliveries = await this.repository.claim(owner, this.config.batchSize, this.config.leaseMs);
      this.lastProgress = Date.now(); const claimed = performance.now();
      renewal = setInterval(() => { void this.repository.renew(owner, this.config.leaseMs).catch(() => { this.lastProgress = 0; }); }, Math.max(1, Math.floor(this.config.leaseMs / 3)));
      const queue = [...deliveries];
      await Promise.all(Array.from({ length: Math.min(this.config.concurrency, deliveries.length) }, async () => {
        while (queue.length) {
          const delivery = queue.shift()!;
          if (!await this.repository.owns(delivery.id, owner)) continue;
          await traced(delivery.destination, delivery.tripId, async () => {
            try {
              if (this.sender.accepts?.(delivery.destination) === false || delivery.kind === 'search' && !await this.repository.searching(delivery.tripId)) { await this.repository.finish(delivery.id, owner, 'skipped'); recordDelivery(delivery.destination, 'skipped', delivery.ageMs, performance.now() - claimed); }
              else { await this.sender.send(delivery); await this.repository.finish(delivery.id, owner, 'delivered'); recordDelivery(delivery.destination, 'delivered', delivery.ageMs, performance.now() - claimed); }
            } catch (error) {
              const retryable = !(error instanceof TransportError) || error.retryable;
              const reason = error instanceof TransportError ? error.reason : 'DISPATCH_ERROR';
              const delay = Math.min(this.config.retryMax, this.config.retryBase * 2 ** Math.min(delivery.attempts - 1, 20)) * (0.8 + Math.random() * 0.2);
              recordDelivery(delivery.destination, retryable ? 'retry' : 'blocked', delivery.ageMs, performance.now() - claimed);
              await this.repository.finish(delivery.id, owner, retryable ? 'pending' : 'blocked', reason, Math.ceil(delay));
              console.warn(JSON.stringify({ event: 'outbox_delivery_failed', deliveryId: delivery.id, tripId: delivery.tripId, destination: delivery.destination, reason, retryable, attempts: delivery.attempts }));
            }
          });
          this.lastProgress = Date.now();
        }
      }));
      return deliveries.length;
    } finally { if (renewal) clearInterval(renewal); this.active = false; }
  }
}
