import 'reflect-metadata';
import 'dotenv/config';
import { createServer } from 'node:http';
import { loadConfig } from './bootstrap/config';
import { source, Repository } from './infrastructure/persistence';
import { HttpClients } from './infrastructure/clients';
import { OfferPublisher } from './infrastructure/publisher';
import { MatchDriver } from './application/match';
import { AssignDriver } from './application/decisions';
import { MatchingWorker } from './application/worker';
import { OfferExpiry } from './application/expiry';
async function main() {
  const c = loadConfig(), db = source(c.databaseUrl); await db.initialize(); const repo = new Repository(db), clients = new HttpClients(c), worker = new MatchingWorker(repo, new MatchDriver(repo, clients, c.pollMs), new AssignDriver(repo, clients), c), publisher = new OfferPublisher(repo, c.rabbitUrl);
  const expiry = new OfferExpiry(repo);
  let stop = false; let active: Promise<void> | undefined; let expiring: Promise<void> | undefined;
  const tick = () => { if (stop || active) return; active = Promise.all([worker.tick(), publisher.tick()]).then(() => {}).catch(() => { console.warn('matching_worker_dependency_unavailable'); }).finally(() => { active = undefined; }); };
  const expire = () => { if (stop || expiring) return; expiring = expiry.tick().catch(() => { console.warn('matching_expiry_dependency_unavailable'); }).finally(() => { expiring = undefined; }); };
  const timer = setInterval(tick, c.scanMs), expiryTimer = setInterval(expire, c.scanMs); tick(); expire();
  const server = createServer((req, res) => { if (req.url !== '/health/live' && req.url !== '/health/ready') { res.writeHead(404); res.end(); return; } const ready = !stop && (req.url === '/health/live' || worker.lastProgress > Date.now() - 90000); res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: ready ? 'ok' : 'unavailable' })); }); server.listen(Number(process.env.WORKER_HEALTH_PORT ?? 3017), c.host);
  const shutdown = async () => { if (stop) return; stop = true; clearInterval(timer); clearInterval(expiryTimer); await Promise.all([active, expiring]); await publisher.close(); await new Promise<void>(r => server.close(() => r())); await db.destroy(); };
  process.once('SIGTERM', () => { void shutdown(); }); process.once('SIGINT', () => { void shutdown(); });
}
void main().catch(() => { console.error('Matching worker startup failed'); process.exitCode = 1; });
