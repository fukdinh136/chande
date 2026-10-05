import { loadConfig, loadLocalEnvironment } from './bootstrap/config';
import { RoutingRuntime } from './bootstrap/runtime';
import { createApp } from './api/http';
async function main() {
  const config = loadConfig(loadLocalEnvironment());
  const app = await createApp(new RoutingRuntime(config));
  await app.listen(config.port, config.host);
  process.stdout.write('Routing Service ready\n');
}
void main().catch(() => { process.stderr.write('Routing Service startup failed; check configuration\n'); process.exitCode = 1; });
