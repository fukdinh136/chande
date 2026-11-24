import { createServer } from 'node:http';
import type { Config } from './config';
import type { Store } from '../application/ports/store';
import type { OutboxDispatcher } from '../infrastructure/outbox/dispatcher';
export async function startWorker(dispatcher: OutboxDispatcher, store: Store, config: Pick<Config, 'workerPort' | 'pollInterval' | 'heartbeatMaxAge' | 'batchSize'>, host = '0.0.0.0') {
  let stopping = false; let timer: NodeJS.Timeout | undefined; let immediate: NodeJS.Immediate | undefined; let current: Promise<void> = Promise.resolve();
  // A full batch means more deliveries are probably waiting, so run the next batch right away.
  // Rest for pollInterval only when the queue looks drained or the tick failed (no hot loop on errors).
  const schedule = () => {
    if (stopping) return;
    timer = undefined; immediate = undefined;
    current = dispatcher.tick()
      .then(claimed => claimed >= config.batchSize)
      .catch(() => { dispatcher.lastProgress = 0; console.warn(JSON.stringify({ event: 'outbox_tick_failed' })); return false; })
      .then(full => { if (stopping) return; if (full) immediate = setImmediate(schedule); else timer = setTimeout(schedule, config.pollInterval); });
  };
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'GET' || !['/health/live', '/health/ready'].includes(req.url ?? '')) { res.writeHead(404); res.end(); return; }
      const ready = req.url === '/health/live' ? !stopping : !stopping && Date.now() - dispatcher.lastProgress <= config.heartbeatMaxAge && await store.ready();
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ status: ready ? 'ok' : 'unavailable' }));
    })().catch(() => { res.writeHead(503); res.end('{"status":"unavailable"}'); });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(config.workerPort, host, () => { server.removeListener('error', reject); resolve(); }); });
  schedule(); await current;
  return { server, stop: async () => { if (stopping) return; stopping = true; if (timer) clearTimeout(timer); if (immediate) clearImmediate(immediate); await current; server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
