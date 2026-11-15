import './bootstrap/telemetry';
import { loadConfig, loadLocalEnvironment } from './bootstrap/config';
import { RoutingRuntime } from './bootstrap/runtime';
import { createApp } from './api/http';
import { routingGrpc } from './api/grpc';
import { grpcPort } from './infrastructure/grpc';
async function main() {
  const config = loadConfig(loadLocalEnvironment());
  const runtime = new RoutingRuntime(config);
  const app = await createApp(runtime);
  await app.listen(config.port, config.host);
  // The same internal API over gRPC (GRPC_PORT, default 50055); callers pick it with INTERNAL_TRANSPORT=grpc.
  const grpcServer = routingGrpc(runtime); await grpcServer.listen(config.host, grpcPort('routing'));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void grpcServer.close(); });
  process.stdout.write('Routing Service ready\n');
}
void main().catch(() => { process.stderr.write('Routing Service startup failed; check configuration\n'); process.exitCode = 1; });
