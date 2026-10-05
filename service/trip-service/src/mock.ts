import 'dotenv/config';
import { resolve } from 'node:path';
import { createMockServer } from './bootstrap/mock-server';
async function main() {
  const port = Number(process.env.MOCK_PORT ?? 3003); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid mock port');
  const server = await createMockServer({ file: resolve(process.env.MOCK_DATA_FILE ?? '.mock-data/state.json'), apiUrl: process.env.MOCK_TRIP_API_URL ?? 'http://127.0.0.1:3001', callbackToken: process.env.MATCHING_CALLBACK_TOKEN ?? 'local-callback', issuer: process.env.AUTH_JWT_ISSUER ?? 'chande-local', audience: process.env.AUTH_JWT_AUDIENCE ?? 'trip-service', tokens: { routing: process.env.ROUTING_TOKEN ?? 'local-routing', pricing: process.env.PRICING_TOKEN ?? 'local-pricing', matching: process.env.MATCHING_TOKEN ?? 'local-matching', gateway: process.env.GATEWAY_EVENTS_TOKEN ?? 'local-gateway', notification: process.env.NOTIFICATION_TOKEN ?? 'local-notification' } });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', resolve); });
  const stop = () => { server.closeAllConnections(); server.close(); }; process.once('SIGTERM', stop); process.once('SIGINT', stop);
  console.info(JSON.stringify({ event: 'development_mocks_started', port }));
}
void main().catch(() => { console.error('Mock startup failed'); process.exitCode = 1; });
