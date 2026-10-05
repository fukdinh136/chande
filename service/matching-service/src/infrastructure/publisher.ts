import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { Repository } from './persistence';
export const EXCHANGE = 'matching.offers', QUEUE = 'driver.offers';
export async function topology(channel: ConfirmChannel) {
  await channel.assertExchange(EXCHANGE, 'direct', { durable: true });
  await channel.assertExchange('matching.offers.dlx', 'direct', { durable: true });
  await channel.assertQueue('driver.offers.dlq', { durable: true }); await channel.bindQueue('driver.offers.dlq', 'matching.offers.dlx', 'dead');
  await channel.assertQueue(QUEUE, { durable: true, arguments: { 'x-dead-letter-exchange': 'matching.offers.dlx', 'x-dead-letter-routing-key': 'dead' } }); await channel.bindQueue(QUEUE, EXCHANGE, 'offer');
  for (const delay of [1000, 10000, 30000]) { const queue = `${QUEUE}.retry.${delay}`; await channel.assertQueue(queue, { durable: true, arguments: { 'x-message-ttl': delay, 'x-dead-letter-exchange': EXCHANGE, 'x-dead-letter-routing-key': 'offer' } }); }
}
export class OfferPublisher {
  private model?: ChannelModel; private channel?: ConfirmChannel; private busy = false;
  constructor(private readonly repo: Repository, private readonly url: string) {}
  async open() {
    if (this.channel) return this.channel;
    const model = await connect(this.url, { timeout: 5000 }); model.on('error', () => {}); model.on('close', () => { if (this.model === model) { this.model = undefined; this.channel = undefined; } });
    const channel = await model.createConfirmChannel(); channel.on('error', () => {}); channel.on('close', () => { if (this.channel === channel) this.channel = undefined; });
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
  async tick() {
    if (this.busy) return; this.busy = true;
    try {
      for (let index = 0; index < 10; index++) {
        const lease = randomUUID(); const rows: { id: string; payload: unknown; attempts: number }[] = await this.repo.db.transaction(db => db.query(`WITH due AS (SELECT id FROM matching_outbox WHERE published_at IS NULL AND due_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY due_at LIMIT 1 FOR UPDATE SKIP LOCKED), claimed AS (UPDATE matching_outbox o SET lease_id=$1,lease_until=clock_timestamp()+interval '60 seconds',attempts=o.attempts+1 FROM due WHERE o.id=due.id RETURNING o.id,o.payload,o.attempts) SELECT * FROM claimed`, [lease]));
        const message = rows[0]; if (!message) return;
        try { await this.send(await this.open(), message.id, message.payload); await this.repo.db.query('UPDATE matching_outbox SET published_at=clock_timestamp(),lease_id=NULL,lease_until=NULL WHERE id=$1 AND lease_id=$2', [message.id, lease]); }
        catch { const delay = Math.ceil(Math.min(30000, 1000 * 2 ** Math.min(message.attempts - 1, 10)) * (0.8 + Math.random() * 0.2)); await this.repo.db.query("UPDATE matching_outbox SET lease_id=NULL,lease_until=NULL,due_at=clock_timestamp()+$3*interval '1 millisecond' WHERE id=$1 AND lease_id=$2", [message.id, lease, delay]); return; }
      }
    } finally { this.busy = false; }
  }
  async close() { const model = this.model; this.model = undefined; this.channel = undefined; await model?.close().catch(() => {}); }
}
