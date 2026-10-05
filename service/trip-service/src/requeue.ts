import 'dotenv/config';
import { loadConfig } from './bootstrap/config';
import { createDataSource } from './infrastructure/persistence/connection';
import { PgOutbox } from './infrastructure/outbox/repository';
async function main() {
  const id = process.argv[2]; if (!id || !/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) throw new Error('A delivery ID is required');
  const config = loadConfig(process.env, 'migration'); const db = await createDataSource(config.databaseUrl).initialize();
  try { const changed = await new PgOutbox(db).requeue(id); console.info(JSON.stringify({ deliveryId: id, requeued: changed })); if (!changed) process.exitCode = 1; } finally { await db.destroy(); }
}
void main().catch(() => { console.error('Requeue failed; check delivery ID and database access'); process.exitCode = 1; });
