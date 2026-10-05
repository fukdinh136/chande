import 'reflect-metadata';
import 'dotenv/config';
import { source } from './infrastructure/persistence';
import { uuid } from './domain/models';
async function main() { const id = uuid.parse(process.argv[2]); if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required'); const db = source(process.env.DATABASE_URL); await db.initialize(); try { await db.query('UPDATE matching_outbox SET due_at=clock_timestamp() WHERE id=$1 AND published_at IS NULL AND (lease_until IS NULL OR lease_until<clock_timestamp())', [id]); console.info(JSON.stringify({ event: 'outbox_requeue_requested', eventId: id })); } finally { await db.destroy(); } }
void main().catch(() => { console.error('Requeue failed; provide an event UUID and Matching database configuration'); process.exitCode = 1; });
