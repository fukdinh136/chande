import { createServer } from 'node:http';
import type { Config } from './config';
import type { Store } from '../application/ports/store';
import type { OutboxDispatcher } from '../infrastructure/outbox/dispatcher';
export async function startWorker(dispatcher: OutboxDispatcher, store: Store, config: Pick<Config, 'workerPort' | 'pollInterval' | 'heartbeatMaxAge'>, host = '0.0.0.0') {
  let stopping = false; let timer: NodeJS.Timeout | undefined; let current: Promise<void> = Promise.resolve();
  const schedule = () => {
    if (stopping) return;
    current = dispatcher.tick().catch(() => { dispatcher.lastProgress = 0; console.warn(JSON.stringify({ event: 'outbox_tick_failed' })); }).finally(() => { if (!stopping) timer = setTimeout(schedule, config.pollInterval); });
  };
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'GET' || !['/health/live', '/health/ready'].includes(req.url ?? '')) { res.writeHead(404); res.end(); return; }
      const ready = req.url === '/health/live' ? !stopping : !stopping && Date.now() - dispatcher.lastProgress <= config.heartbeatMaxAge && await store.ready();
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ status: ready ? 'ok' : 'unavailable' }));
    })().catch(() => { res.writeHead(503); res.end('{"status":"unavailable"}'); });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(config.workerPort, host, () => { server.removeListener('error', reject); resolve(); }); });
  schedule();
  return { server, stop: async () => { if (stopping) return; stopping = true; if (timer) clearTimeout(timer); await current; server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
