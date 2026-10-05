import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../../bootstrap/config';
import { JsonHttpClient, TransportError } from '../clients/http';
import { MatchingClient } from '../clients/matching';
import { PgOutbox, type Delivery } from './repository';
export interface DeliverySender { send(delivery: Delivery): Promise<void> }
export class HttpDeliverySender implements DeliverySender {
  private readonly matching: MatchingClient;
  private readonly targets: Record<string, JsonHttpClient>;
  constructor(config: Config) {
    this.targets = { matching: new JsonHttpClient(config.matchingUrl, config.matchingToken, config.httpTimeout), gateway: new JsonHttpClient(config.gatewayUrl, config.gatewayToken, config.httpTimeout), notification: new JsonHttpClient(config.notificationUrl, config.notificationToken, config.httpTimeout) };
    this.matching = new MatchingClient(this.targets.matching!);
  }
  async send(delivery: Delivery): Promise<void> {
    const requestId = randomUUID();
    if (delivery.kind !== 'event') { if (delivery.destination !== 'matching') throw new TransportError(false, 'INVALID_DESTINATION'); return this.matching.send(delivery.kind, delivery.payload, requestId); }
    const ack = await this.targets[delivery.destination]!.post('/internal/events/trips', delivery.payload, requestId, z.object({ eventId: z.uuid(), accepted: z.literal(true) }).strict(), 202);
    if (ack.eventId !== delivery.payload.eventId) throw new TransportError(false, 'INVALID_ACK');
  }
}
export class OutboxDispatcher {
  lastProgress = 0;
  private active = false;
  constructor(private readonly repository: PgOutbox, private readonly sender: DeliverySender, private readonly config: Pick<Config, 'batchSize' | 'concurrency' | 'leaseMs' | 'retryBase' | 'retryMax'>) {}
  async tick(): Promise<void> {
    if (this.active) return; this.active = true; const owner = randomUUID();
    let renewal: NodeJS.Timeout | undefined;
    try {
      const deliveries = await this.repository.claim(owner, this.config.batchSize, this.config.leaseMs);
      this.lastProgress = Date.now();
      renewal = setInterval(() => { void this.repository.renew(owner, this.config.leaseMs).catch(() => { this.lastProgress = 0; }); }, Math.max(1, Math.floor(this.config.leaseMs / 3)));
      const queue = [...deliveries];
      await Promise.all(Array.from({ length: Math.min(this.config.concurrency, deliveries.length) }, async () => {
        while (queue.length) {
          const delivery = queue.shift()!;
          if (!await this.repository.owns(delivery.id, owner)) continue;
          try {
            if (delivery.kind === 'search' && !await this.repository.searching(delivery.tripId)) await this.repository.finish(delivery.id, owner, 'skipped');
            else { await this.sender.send(delivery); await this.repository.finish(delivery.id, owner, 'delivered'); }
          } catch (error) {
            const retryable = !(error instanceof TransportError) || error.retryable;
            const reason = error instanceof TransportError ? error.reason : 'DISPATCH_ERROR';
            const delay = Math.min(this.config.retryMax, this.config.retryBase * 2 ** Math.min(delivery.attempts - 1, 20)) * (0.8 + Math.random() * 0.2);
            await this.repository.finish(delivery.id, owner, retryable ? 'pending' : 'blocked', reason, Math.ceil(delay));
            console.warn(JSON.stringify({ event: 'outbox_delivery_failed', deliveryId: delivery.id, tripId: delivery.tripId, destination: delivery.destination, reason, retryable, attempts: delivery.attempts }));
          }
          this.lastProgress = Date.now();
        }
      }));
    } finally { if (renewal) clearInterval(renewal); this.active = false; }
  }
}
