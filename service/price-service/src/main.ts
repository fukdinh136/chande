import 'dotenv/config';
import { loadConfig } from './bootstrap/config';
import { createApi } from './api/app';
async function main() { const config = loadConfig(); const app = await createApi(config); await app.listen(config.port, config.host); process.stdout.write('Price Service ready\n'); }
void main().catch(() => { process.stderr.write('Price Service startup failed; check configuration\n'); process.exitCode = 1; });
