import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MapProvider } from '../../src/application/ports/clients';
import { systemClock } from '../../src/application/ports/clients';
import { WorkerPool } from '../../src/infrastructure/pipeline/pool';
import { RoutingError } from '../../src/domain/errors';
import { config, context, routeJob, tick } from '../helpers/fixtures';
const ok = { distanceMeters: 1, durationSeconds: 2, steps: [] };
const permit = { acquire: async () => undefined };
test('bounded pool caps concurrency, rejects overflow and preserves result identity', async () => {
  const gates: (() => void)[] = []; let calls = 0; let running = 0; let max = 0;
  const provider: MapProvider = { route: async () => { const id = ++calls; running++; max = Math.max(max, running); await new Promise<void>(r => gates.push(r)); running--; return { ...ok, distanceMeters: id }; }, matrix: async () => [] };
  const pool = new WorkerPool(provider, permit, { ...config().limits, queueSize: 1 }, systemClock);
  const a = pool.dispatch(routeJob, context()); const b = pool.dispatch(routeJob, context()); const c = pool.dispatch(routeJob, context());
  await assert.rejects(pool.dispatch(routeJob, context()), /ROUTING_BUSY/); await tick(); assert.equal(calls, 2);
  gates[0]!(); assert.equal((await a).distanceMeters, 1); await tick(); assert.equal(calls, 3); gates[1]!(); gates[2]!();
  assert.equal((await b).distanceMeters, 2); assert.equal((await c).distanceMeters, 3); await pool.close(); assert.equal(max, 2); assert.deepEqual(pool.stats, { accepting: false, running: 0, queued: 0 });
});
test('queued cancellation never reaches provider and worker survives exceptions', async () => {
  let release!: () => void; let calls = 0;
  const provider: MapProvider = { route: async () => { calls++; if (calls === 1) await new Promise<void>(r => { release = r; }); if (calls === 2) throw new Error('failure'); return ok; }, matrix: async () => [] };
  const pool = new WorkerPool(provider, permit, { ...config().limits, workers: 1 }, systemClock);
  const a = pool.dispatch(routeJob, context()); const ctrl = new AbortController(); const b = pool.dispatch(routeJob, context(ctrl.signal)); ctrl.abort();
  await assert.rejects(b, /ROUTING_DEADLINE_EXCEEDED/); await tick(); release(); await a; await tick();
  await assert.rejects(pool.dispatch(routeJob, context()), /failure/); await tick(); assert.deepEqual(await pool.dispatch(routeJob, context()), ok); await pool.close(); assert.equal(calls, 3);
});
test('expired queue and shutdown settle every Promise even for hanging adapters', async () => {
  const provider: MapProvider = { route: () => new Promise(() => undefined), matrix: async () => [] };
  const pool = new WorkerPool(provider, permit, { ...config().limits, workers: 1, queueWait: 10, shutdownGrace: 10 }, systemClock);
  const a = pool.dispatch(routeJob, context()); const aRejected = assert.rejects(a, /ROUTING_BUSY/);
  await assert.rejects(pool.dispatch(routeJob, context()), /ROUTING_BUSY/);
  await pool.close(); await aRejected; assert.equal(pool.stats.running, 0); await assert.rejects(pool.dispatch(routeJob, context()), /ROUTING_BUSY/);
});
test('active deadline frees slots and retry obtains a fresh permit', async () => {
  let calls = 0; let permits = 0;
  const provider: MapProvider = { route: async () => { if (++calls === 1) throw new RoutingError('PROVIDER_UNAVAILABLE', 503, true); return ok; }, matrix: async () => [] };
  const pool = new WorkerPool(provider, { acquire: async () => { permits++; } }, { ...config().limits, retryBase: 1 }, systemClock);
  assert.deepEqual(await pool.dispatch(routeJob, context()), ok); assert.equal(permits, 2); await pool.close();
  const hanging = new WorkerPool({ ...provider, route: () => new Promise(() => undefined) }, permit, config().limits, systemClock);
  await assert.rejects(hanging.dispatch(routeJob, { ...context(), deadline: performance.now() + 10 }), /ROUTING_DEADLINE_EXCEEDED/); await tick(); assert.equal(hanging.stats.running, 0); await hanging.close();
});
