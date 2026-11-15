import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { JsonHttpClient } from '../../src/infrastructure/clients/http';
import { withServer } from '../http-server';
import { CircuitBreaker } from '../../src/infrastructure/circuit-breaker';
test('HTTP client stops calling a failing dependency: retryable CIRCUIT_OPEN until a trial succeeds', async () => {
  let hits = 0, status = 500; const clock = { t: 0 };
  await withServer(() => { hits++; return { status, body: status === 200 ? { data: 'ok', meta: { requestId: randomUUID() } } : {} }; }, async url => {
    const client = new JsonHttpClient(url, 'test', 1000, new CircuitBreaker('matching', { failureThreshold: 3, openMs: 5000, now: () => clock.t, onChange: () => {} }));
    for (let i = 0; i < 3; i++) await assert.rejects(client.post('/test', {}, randomUUID(), z.string()), { reason: 'HTTP_500', retryable: true });
    await assert.rejects(client.post('/test', {}, randomUUID(), z.string()), { reason: 'CIRCUIT_OPEN', retryable: true });
    assert.equal(hits, 3);
    clock.t += 5000; status = 200;
    assert.equal(await client.post('/test', {}, randomUUID(), z.string()), 'ok');
    assert.equal(client.breaker.state, 'closed'); assert.equal(hits, 4);
  });
});
test('HTTP client breaker ignores answers the dependency gives on purpose: 4xx and 429', async () => {
  await withServer(() => ({ status: 429, body: {} }), async url => {
    const client = new JsonHttpClient(url, 'test', 1000, new CircuitBreaker('pricing', { failureThreshold: 2, onChange: () => {} }));
    for (let i = 0; i < 4; i++) await assert.rejects(client.post('/test', {}, randomUUID(), z.string()), { reason: 'HTTP_429' });
    assert.equal(client.breaker.state, 'closed');
  });
});
test('HTTP client bounds upstream response size before parsing JSON', async () => {
  await withServer(() => ({ body: { data: 'x'.repeat(1048577), meta: { requestId: randomUUID() } } }), async url => {
    await assert.rejects(new JsonHttpClient(url, 'test', 1000).post('/test', {}, randomUUID(), z.string()), { reason: 'RESPONSE_TOO_LARGE', retryable: false });
  });
});
