import 'dotenv/config';
import { loadConfig } from './bootstrap/config';
import { createDataSource } from './infrastructure/persistence/connection';
import { PgStore } from './infrastructure/persistence/store';
import { PgOutbox } from './infrastructure/outbox/repository';
import { HttpDeliverySender, OutboxDispatcher } from './infrastructure/outbox/dispatcher';
import { startWorker } from './bootstrap/worker-runtime';
import { startPurge } from './bootstrap/purge';
const PURGE_BATCH = 1000;
async function main() {
  const config = loadConfig(process.env, 'worker'); const db = await createDataSource(config.databaseUrl, config.poolSize).initialize();
  try {
    const store = new PgStore(db); if (!await store.ready()) throw new Error('Database migrations required');
    const outbox = new PgOutbox(db);
    const worker = await startWorker(new OutboxDispatcher(outbox, new HttpDeliverySender(config), config), store, config);
    // Keep delivered messages for OUTBOX_RETENTION_MS (default 24 h) for diagnosis, then delete them in batches.
    const stopPurge = startPurge(() => outbox.purge(config.retentionMs, PURGE_BATCH), PURGE_BATCH, config.purgeInterval);
    let stopping = false; const stop = () => { if (stopping) return; stopping = true; void Promise.all([worker.stop(), stopPurge()]).then(() => db.destroy()).catch(() => { process.exitCode = 1; }); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
    console.info(JSON.stringify({ event: 'worker_started', port: config.workerPort }));
  } catch (error) { await db.destroy(); throw error; }
}
void main().catch(() => { console.error('Trip worker startup failed; check configuration, database and migrations'); process.exitCode = 1; });
