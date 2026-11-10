import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../../src/infrastructure/pipeline/limiter';
import type { Context } from '../../src/application/ports/clients';
import { RoutingError } from '../../src/domain/errors';
const busyFor = (reason: string) => (error: unknown) => error instanceof RoutingError && error.code === 'ROUTING_BUSY' && error.reason === reason;
function fixture(overrides = {}) {
  let now = 0;
  const limiter = new RateLimiter({ rps: 2, burst: 2, elementsPerMinute: 4, rateWait: 1000, ...overrides }, { now: () => now, iso: () => '' }, async ms => { now += ms; });
  const ctx: Context = { requestId: 'test', deadline: 100000, signal: new AbortController().signal };
  return { limiter, ctx, getNow: () => now, setNow: (value: number) => { now = value; } };
}
test('burst and refill enforce request permits including retries', async () => {
  const f = fixture(); await f.limiter.acquire(0, f.ctx); await f.limiter.acquire(0, f.ctx); assert.equal(f.getNow(), 0);
  await f.limiter.acquire(0, f.ctx); assert.equal(f.getNow(), 500);
});
test('matrix budgets are per attempt, expire after one minute and never overdraw', async () => {
  const f = fixture(); await f.limiter.acquire(3, f.ctx);
  await assert.rejects(f.limiter.acquire(2, f.ctx), busyFor('matrix_budget')); await f.limiter.acquire(1, f.ctx);
  f.setNow(60000); await f.limiter.acquire(4, f.ctx); await assert.rejects(f.limiter.acquire(5, f.ctx), busyFor('matrix_too_large'));
});
test('concurrent requests cannot acquire more than burst with zero wait budget', async () => {
  const f = fixture({ rateWait: 1 }); const results = await Promise.allSettled([1, 2, 3, 4].map(() => f.limiter.acquire(0, f.ctx)));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 2);
});
test('cancelled or expired requests do not consume permits', async () => {
  const f = fixture(); const abort = new AbortController(); abort.abort();
  await assert.rejects(f.limiter.acquire(0, { ...f.ctx, signal: abort.signal }), /ROUTING_DEADLINE_EXCEEDED/);
  await assert.rejects(f.limiter.acquire(0, { ...f.ctx, deadline: 0 }), /ROUTING_DEADLINE_EXCEEDED/);
  await f.limiter.acquire(0, f.ctx); await f.limiter.acquire(0, f.ctx); assert.equal(f.getNow(), 0);
});
test('a caller that cannot get a request token in time is told it was the rate limit', async () => {
  const f = fixture({ rateWait: 100 }); await f.limiter.acquire(0, f.ctx); await f.limiter.acquire(0, f.ctx);
  await assert.rejects(f.limiter.acquire(0, f.ctx), busyFor('rate_limit'));
});
