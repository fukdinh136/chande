import './bootstrap/telemetry';
import 'dotenv/config';
import { loadConfig } from './bootstrap/config';
import { TripContext } from './bootstrap/context';
import { createDataSource } from './infrastructure/persistence/connection';
import { PgStore } from './infrastructure/persistence/store';
import { createApi } from './api/app';
import { tripGrpc } from './api/grpc';
import { grpcPort } from './infrastructure/grpc';
async function main() {
  const config = loadConfig(); const db = await createDataSource(config.databaseUrl, config.poolSize).initialize();
  try {
    const store = new PgStore(db); if (!await store.ready()) throw new Error('Database migrations required');
    const context = new TripContext(config, store); const app = await createApi(context); await app.listen(config.port, '0.0.0.0');
    // The same internal API over gRPC (GRPC_PORT, default 50051); callers pick it with INTERNAL_TRANSPORT=grpc.
    const grpcServer = tripGrpc(context); await grpcServer.listen('0.0.0.0', grpcPort('trip'));
    let stopping = false;
    const stop = () => { if (stopping) return; stopping = true; void Promise.all([app.close(), grpcServer.close()]).then(() => db.destroy()).catch(() => { process.exitCode = 1; }); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
    console.info(JSON.stringify({ event: 'api_started', port: config.port }));
  } catch (error) { await db.destroy(); throw error; }
}
void main().catch(() => { console.error('Trip API startup failed; check configuration, database and migrations'); process.exitCode = 1; });
