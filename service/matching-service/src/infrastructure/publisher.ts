import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { Repository } from './persistence';
import { recordOutboxLag } from '../application/metrics';
export const EXCHANGE = 'matching.offers', QUEUE = 'driver.offers';
/** Messages claimed, sent and marked together. */
const CLAIM_CHUNK = 50;
export async function topology(channel: ConfirmChannel) {
  await channel.assertExchange(EXCHANGE, 'direct', { durable: true });
  await channel.assertExchange('matching.offers.dlx', 'direct', { durable: true });
  await channel.assertQueue('driver.offers.dlq', { durable: true }); await channel.bindQueue('driver.offers.dlq', 'matching.offers.dlx', 'dead');
  await channel.assertQueue(QUEUE, { durable: true, arguments: { 'x-dead-letter-exchange': 'matching.offers.dlx', 'x-dead-letter-routing-key': 'dead' } }); await channel.bindQueue(QUEUE, EXCHANGE, 'offer');
  for (const delay of [1000, 10000, 30000]) { const queue = `${QUEUE}.retry.${delay}`; await channel.assertQueue(queue, { durable: true, arguments: { 'x-message-ttl': delay, 'x-dead-letter-exchange': EXCHANGE, 'x-dead-letter-routing-key': 'offer' } }); }
}
export class OfferPublisher {
  private model?: ChannelModel; private channel?: ConfirmChannel; private busy = false;
  constructor(private readonly repo: Repository, private readonly url: string, private readonly batchMax = 200) {}
  async open() {
    if (this.channel) return this.channel;
    const model = await connect(this.url, { timeout: 5000 }); model.on('error', () => {}); model.on('close', () => { if (this.model === model) { this.model = undefined; this.channel = undefined; } });
    const channel = await model.createConfirmChannel(); channel.setMaxListeners(0); channel.on('error', () => {}); channel.on('close', () => { if (this.channel === channel) this.channel = undefined; });
    await topology(channel); this.model = model; this.channel = channel; return channel;
  }
  private async send(channel: ConfirmChannel, id: string, payload: unknown) {
    await new Promise<void>((resolve, reject) => {
      const returned = (message: import('amqplib').Message) => { if (message.properties.messageId === id) finish(new Error('UNROUTABLE')); };
      const closed = () => finish(new Error('BROKER_CLOSED'));
      const timer = setTimeout(() => { finish(new Error('CONFIRM_TIMEOUT')); void this.close(); }, 5000);
      const finish = (error?: Error | null) => { clearTimeout(timer); channel.off('return', returned); channel.off('close', closed); if (error) reject(error); else resolve(); };
      channel.on('return', returned); channel.once('close', closed);
      try { channel.publish(EXCHANGE, 'offer', Buffer.from(JSON.stringify(payload)), { persistent: true, mandatory: true, contentType: 'application/json', messageId: id }, error => finish(error)); } catch { finish(new Error('PUBLISH_FAILED')); }
    });
  }
  /**
   * Publishes due messages oldest due_at first, in chunks of up to CLAIM_CHUNK: one statement claims a chunk, every
   * message is sent and confirmed, and one statement marks the confirmed ones published. Under load a chunk holds
   * several messages, so the outbox costs two writes per chunk instead of two per message.
   * Returns true when it stopped at batchMax, i.e. more messages may be waiting. A failed send backs off that
   * message and ends the round, so a broken broker is not hammered.
   */
  async tick(): Promise<boolean> {
    if (this.busy) return false; this.busy = true;
    try {
      for (let sent = 0; sent < this.batchMax;) {
        const lease = randomUUID(), limit = Math.min(CLAIM_CHUNK, this.batchMax - sent);
        const rows: { id: string; payload: unknown; attempts: number; lag_ms: number }[] = await this.repo.db.query(`WITH due AS (SELECT id FROM matching_outbox WHERE published_at IS NULL AND due_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY due_at LIMIT $2 FOR UPDATE SKIP LOCKED), claimed AS (UPDATE matching_outbox o SET lease_id=$1,lease_until=clock_timestamp()+interval '60 seconds',attempts=o.attempts+1 FROM due WHERE o.id=due.id RETURNING o.id,o.payload,o.attempts,o.due_at,(extract(epoch FROM clock_timestamp()-o.due_at)*1000)::float8 AS lag_ms) SELECT id,payload,attempts,lag_ms FROM claimed ORDER BY due_at,id`, [lease, limit]);
        if (!rows.length) return false; const claimed = performance.now();
        // publish() is called for each message in order before any confirm is awaited, so the broker keeps due_at order.
        const results = await this.open().then(channel => Promise.allSettled(rows.map(m => this.send(channel, m.id, m.payload))), () => rows.map(() => ({ status: 'rejected' as const })));
        const published = rows.filter((_m, i) => results[i]!.status === 'fulfilled'), failed = rows.filter((_m, i) => results[i]!.status !== 'fulfilled');
        if (published.length) { await this.repo.db.query('UPDATE matching_outbox SET published_at=clock_timestamp(),lease_id=NULL,lease_until=NULL WHERE id=ANY($1::uuid[]) AND lease_id=$2', [published.map(m => m.id), lease]); for (const m of published) recordOutboxLag(m.lag_ms + performance.now() - claimed); }
        for (const m of failed) { const delay = Math.ceil(Math.min(30000, 1000 * 2 ** Math.min(m.attempts - 1, 10)) * (0.8 + Math.random() * 0.2)); await this.repo.db.query("UPDATE matching_outbox SET lease_id=NULL,lease_until=NULL,due_at=clock_timestamp()+$3*interval '1 millisecond' WHERE id=$1 AND lease_id=$2", [m.id, lease, delay]); }
        if (failed.length || rows.length < limit) return false;
        sent += rows.length;
      }
      return true;
    } finally { this.busy = false; }
  }
  async close() { const model = this.model; this.model = undefined; this.channel = undefined; await model?.close().catch(() => {}); }
}
