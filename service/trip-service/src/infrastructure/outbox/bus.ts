import { connect, type ChannelModel, type ConfirmChannel, type Message } from 'amqplib';
import { context, propagation } from '@opentelemetry/api';
import { TransportError } from '../clients/http';
/** ADR-0002: one topic exchange for every trip event; the routing key is the event type (trip.assigned, trip.cancelled...). */
export const EXCHANGE = 'trip.events';
const CONFIRM_TIMEOUT_MS = 5000;
/**
 * Publishes the outbox's trip events to RabbitMQ with publisher confirms: a delivery is marked delivered only after the
 * broker has the message. `mandatory`: with no queue bound yet (no consumer has started) the broker returns the
 * message and it stays in the outbox, instead of being dropped. Consumers declare their own queues; Trip does not know them.
 */
export class TripEventBus {
  private model?: ChannelModel; private channel?: ConfirmChannel; private opening?: Promise<ConfirmChannel>;
  constructor(private readonly url: string) {}
  private open(): Promise<ConfirmChannel> {
    if (this.channel) return Promise.resolve(this.channel);
    this.opening ??= (async () => {
      const model = await connect(this.url, { timeout: 5000 }); model.on('error', () => {});
      model.on('close', () => { if (this.model === model) { this.model = undefined; this.channel = undefined; } });
      const channel = await model.createConfirmChannel(); channel.setMaxListeners(0); channel.on('error', () => {});
      channel.on('close', () => { if (this.channel === channel) this.channel = undefined; });
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      this.model = model; this.channel = channel; return channel;
    })().finally(() => { this.opening = undefined; });
    return this.opening;
  }
  async publish(payload: Record<string, unknown>): Promise<void> {
    const type = payload.type, id = payload.eventId;
    if (typeof type !== 'string' || typeof id !== 'string') throw new TransportError(false, 'INVALID_EVENT');
    let channel: ConfirmChannel;
    try { channel = await this.open(); } catch { throw new TransportError(true, 'BROKER_UNAVAILABLE'); }
    // Trace context travels in the AMQP headers (ADR-0003); with telemetry off this adds nothing.
    const headers: Record<string, string> = {}; propagation.inject(context.active(), headers);
    await new Promise<void>((resolve, reject) => {
      const returned = (message: Message) => { if (message.properties.messageId === id) finish(new TransportError(true, 'UNROUTABLE')); };
      const closed = () => finish(new TransportError(true, 'BROKER_CLOSED'));
      const timer = setTimeout(() => { finish(new TransportError(true, 'CONFIRM_TIMEOUT')); void this.close(); }, CONFIRM_TIMEOUT_MS);
      const finish = (error?: Error | null) => { clearTimeout(timer); channel.off('return', returned); channel.off('close', closed); if (error) reject(error instanceof TransportError ? error : new TransportError(true, 'NACK')); else resolve(); };
      channel.on('return', returned); channel.once('close', closed);
      try { channel.publish(EXCHANGE, type, Buffer.from(JSON.stringify(payload)), { persistent: true, mandatory: true, contentType: 'application/json', messageId: id, type, headers }, error => finish(error)); }
      catch { finish(new TransportError(true, 'PUBLISH_FAILED')); }
    });
  }
  async close() { const model = this.model; this.model = undefined; this.channel = undefined; await model?.close().catch(() => {}); }
}
