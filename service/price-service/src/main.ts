import './bootstrap/telemetry';
import 'dotenv/config';
import { loadConfig } from './bootstrap/config';
import { createApi } from './api/app';
import { priceGrpc } from './api/grpc';
import { CalculateFare } from './application/calculate';
import { FarePolicy } from './domain/fare';
import { grpcPort } from './infrastructure/grpc';
async function main() {
  const config = loadConfig(); const app = await createApi(config); await app.listen(config.port, config.host);
  // The same internal API over gRPC (GRPC_PORT, default 50056); Trip picks it with INTERNAL_TRANSPORT=grpc.
  const grpcServer = priceGrpc(config, new CalculateFare(new FarePolicy(config.policy), config.vehicles)); await grpcServer.listen(config.host, grpcPort('price'));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void grpcServer.close(); });
  process.stdout.write('Price Service ready\n');
}
void main().catch(() => { process.stderr.write('Price Service startup failed; check configuration\n'); process.exitCode = 1; });
