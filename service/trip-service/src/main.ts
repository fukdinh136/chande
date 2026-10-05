import 'dotenv/config';
import { loadConfig } from './bootstrap/config';
import { TripContext } from './bootstrap/context';
import { createDataSource } from './infrastructure/persistence/connection';
import { PgStore } from './infrastructure/persistence/store';
import { createApi } from './api/app';
async function main() {
  const config = loadConfig(); const db = await createDataSource(config.databaseUrl, config.poolSize).initialize();
  try {
    const store = new PgStore(db); if (!await store.ready()) throw new Error('Database migrations required');
    const app = await createApi(new TripContext(config, store)); await app.listen(config.port, '0.0.0.0');
    let stopping = false;
    const stop = () => { if (stopping) return; stopping = true; void app.close().then(() => db.destroy()).catch(() => { process.exitCode = 1; }); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
    console.info(JSON.stringify({ event: 'api_started', port: config.port }));
  } catch (error) { await db.destroy(); throw error; }
}
void main().catch(() => { console.error('Trip API startup failed; check configuration, database and migrations'); process.exitCode = 1; });
