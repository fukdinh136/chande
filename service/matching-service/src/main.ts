import './bootstrap/telemetry';
import 'reflect-metadata';
import 'dotenv/config';
import { loadConfig } from './bootstrap/config';
import { source, Repository } from './infrastructure/persistence';
import { context, createApi } from './api/app';
import { matchingGrpc } from './api/grpc';
import { grpcPort } from './infrastructure/grpc';
async function main() { const c = loadConfig(), db = source(c.databaseUrl); await db.initialize(); const ctx = context(c, new Repository(db)); const app = await createApi(ctx);
  await app.listen(c.port, c.host);
  // The same internal API over gRPC (GRPC_PORT, default 50052); callers pick it with INTERNAL_TRANSPORT=grpc.
  const grpcServer = matchingGrpc(ctx); await grpcServer.listen(c.host, grpcPort('matching'));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void grpcServer.close(); });
}
void main().catch(() => { console.error('Matching startup failed'); process.exitCode = 1; });
