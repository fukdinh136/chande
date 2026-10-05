import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../../src/infrastructure/pipeline/limiter';
import type { Context } from '../../src/application/ports/clients';
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
  await assert.rejects(f.limiter.acquire(2, f.ctx), /ROUTING_BUSY/); await f.limiter.acquire(1, f.ctx);
  f.setNow(60000); await f.limiter.acquire(4, f.ctx); await assert.rejects(f.limiter.acquire(5, f.ctx), /ROUTING_BUSY/);
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
