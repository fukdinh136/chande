import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CircuitBreaker, failedStatus, type BreakerState } from '../src/infrastructure/circuit-breaker';
import { HttpClients, UpstreamError } from '../src/infrastructure/clients';
import { describeFailure, retryDelay, RetryBudget } from '../src/application/retry';
import type { Config } from '../src/bootstrap/config';

function clock() { const c = { t: 1000, now: () => c.t }; return c; }

test('the breaker opens after the failure threshold, fails fast while open, and lets one trial through after openMs', () => {
  const c = clock(), changes: BreakerState[] = [];
  const b = new CircuitBreaker('routing', { failureThreshold: 3, openMs: 5000, now: c.now, onChange: (_d, s) => changes.push(s) });
  for (let i = 0; i < 2; i++) { assert.equal(b.acquire(), 0); b.failure(); }
  assert.equal(b.state, 'closed');
  assert.equal(b.acquire(), 0); b.success();
  for (let i = 0; i < 3; i++) { assert.equal(b.acquire(), 0); b.failure(); }
  assert.equal(b.state, 'open');
  c.t += 1000; assert.equal(b.acquire(), 4000);
  c.t += 4000; assert.equal(b.state, 'half-open');
  assert.equal(b.acquire(), 0, 'the trial call goes through');
  assert.equal(b.acquire(), 1000, 'other calls wait while the trial is running');
  b.failure(); assert.equal(b.state, 'open', 'a failed trial opens the breaker again');
  c.t += 5000; assert.equal(b.acquire(), 0); b.success();
  assert.equal(b.state, 'closed'); assert.equal(b.acquire(), 0);
  assert.deepEqual(changes, ['open', 'half-open', 'open', 'half-open', 'closed']);
});

test('answers from before the breaker opened do not close it', () => {
  const c = clock(), b = new CircuitBreaker('driver', { failureThreshold: 1, openMs: 5000, now: c.now, onChange: () => {} });
  b.failure(); b.success(); b.failure();
  assert.equal(b.state, 'open'); assert.equal(b.acquire(), 5000);
});

test('only no answer or a 5xx without Retry-After counts as a failure', () => {
  assert.equal(failedStatus(500, null), true); assert.equal(failedStatus(503, null), true);
  assert.equal(failedStatus(503, '1'), false, 'busy with Retry-After is left to the caller retry rules');
  for (const status of [200, 202, 400, 404, 409, 429]) assert.equal(failedStatus(status, null), false);
});

async function server(status: number, headers: Record<string, string> = {}): Promise<{ server: Server; url: string; hits: () => number }> {
  let hits = 0;
  const s = createServer((_req, res) => { hits++; res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify({ error: { code: status === 503 ? 'ROUTING_BUSY' : 'INTERNAL', message: 'x' } })); });
  await new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve));
  return { server: s, url: 'http://127.0.0.1:' + (s.address() as AddressInfo).port, hits: () => hits };
}
const origins = [{ id: 'driver-a', lat: 21.03, lng: 105.85 }], pickup = { lat: 21.0285, lng: 105.8542 };
const clients = (routingUrl: string, now?: () => number) => new HttpClients({ routingUrl, routingToken: 't', driverUrl: 'http://driver', tripUrl: 'http://trip', httpTimeout: 2000 } as Config, { failureThreshold: 3, openMs: 5000, onChange: () => {}, ...(now ? { now } : {}) });

test('Matching stops calling a failing dependency and reports CIRCUIT_OPEN with Retry-After until the trial', async () => {
  const c = clock(), up = await server(500);
  try {
    const http = clients(up.url, c.now);
    for (let i = 0; i < 3; i++) assert.equal(describeFailure(await http.eta(pickup, 'CAR_4', origins).catch((e: unknown) => e)).code, 'INTERNAL');
    const open = await http.eta(pickup, 'CAR_4', origins).catch((e: unknown) => e);
    assert.ok(open instanceof UpstreamError);
    assert.deepEqual(describeFailure(open), { dependency: 'routing', code: 'CIRCUIT_OPEN', status: 503, retryAfterMs: 5000 });
    assert.equal(up.hits(), 3, 'the open breaker does not touch Routing');
    assert.equal(http.breaker('driver').state, 'closed', 'each dependency has its own breaker');
    c.t += 5000; await http.eta(pickup, 'CAR_4', origins).catch(() => {});
    assert.equal(up.hits(), 4, 'one trial call after openMs');
  } finally { up.server.close(); }
});

test('busy answers with Retry-After and unreachable services: only the second opens the breaker', async () => {
  const busy = await server(503, { 'Retry-After': '1' });
  try {
    const http = clients(busy.url);
    for (let i = 0; i < 5; i++) await http.eta(pickup, 'CAR_4', origins).catch(() => {});
    assert.equal(http.breaker('routing').state, 'closed'); assert.equal(busy.hits(), 5);
  } finally { busy.server.close(); }
  const down = clients('http://127.0.0.1:1');
  for (let i = 0; i < 3; i++) assert.equal(describeFailure(await down.eta(pickup, 'CAR_4', origins).catch((e: unknown) => e)).code, 'UNREACHABLE');
  assert.equal(describeFailure(await down.eta(pickup, 'CAR_4', origins).catch((e: unknown) => e)).code, 'CIRCUIT_OPEN');
});

test('the retry budget allows soon retries up to the floor or the ratio of jobs, then falls back to backoff', () => {
  const c = clock(), budget = new RetryBudget(0.2, 3, 10000, c.now);
  assert.deepEqual([1, 2, 3, 4].map(() => budget.trySpend()), [true, true, true, false], 'the floor holds without jobs');
  for (let i = 0; i < 30; i++) budget.job();
  assert.equal(budget.trySpend(), true, '20% of 30 jobs is 6 retries');
  assert.equal(budget.trySpend(), true); assert.equal(budget.trySpend(), true); assert.equal(budget.trySpend(), false);
  c.t += 15000; assert.equal(budget.trySpend(), false, 'half of the previous window still counts: 3 retries of max(3, 0.2 × 15 jobs)');
  for (let i = 0; i < 10; i++) budget.job();
  assert.equal(budget.trySpend(), true, 'new jobs refill the budget: 0.2 × 25 jobs');
  c.t += 20000; assert.deepEqual([1, 2, 3, 4].map(() => budget.trySpend()), [true, true, true, false], 'old windows are forgotten');
  const busy = describeFailure(new UpstreamError(503, 'CIRCUIT_OPEN', 'routing', 5000));
  assert.equal(retryDelay(4, busy, () => 1, true), 2000);
  assert.equal(retryDelay(4, busy, () => 1, false), 8000, 'a busy failure past the budget backs off');
});
