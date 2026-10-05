import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../../src/api/http';
import { RoutingRuntime } from '../../src/bootstrap/runtime';
import { config, point, tick } from '../helpers/fixtures';
import type { MapProvider } from '../../src/application/ports/clients';
const input = { pickup: point, destination: point, vehicleType: 'MOCK_BIKE' };
async function fixture(run: (url: string, runtime: RoutingRuntime, app: INestApplication) => Promise<void>, provider?: MapProvider) {
  const runtime = new RoutingRuntime(config({ RATE_LIMIT_REQUESTS_PER_SECOND: '1000', RATE_LIMIT_BURST: '100' }), undefined, provider);
  const app = await createApp(runtime); await app.listen(0, '127.0.0.1');
  try { await run(await app.getUrl(), runtime, app); } finally { await app.close(); }
}
const post = (url: string, body: unknown, token = 'trip-test-token', path = '/internal/routes/estimate', requestId?: string) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': token, ...(requestId ? { 'x-request-id': requestId } : {}) }, body: JSON.stringify(body) });
test('HTTP estimate envelope, generated correlation, full route and OpenAPI', async () => {
  await fixture(async url => {
    const response = await post(url, input); assert.equal(response.status, 200); const result = await response.json(); assert.deepEqual(result.data, { distanceMeters: 4000, durationSeconds: 600 }); assert.match(result.meta.requestId, /^[a-f0-9-]{36}$/); assert.equal(response.headers.get('x-request-id'), result.meta.requestId);
    const id = '90000000-0000-4000-8000-000000000001'; const full = await post(url, { origin: point, destination: point, vehicleType: 'MOCK_BIKE' }, 'gateway-test-token', '/routes', id); assert.equal(full.status, 200); assert.equal((await full.json()).meta.requestId, id);
    const doc = await fetch(url + '/openapi.json'); assert.equal(doc.status, 200); const schema = await doc.json(); assert.ok(schema.paths['/internal/routes/estimate']);
    assert.deepEqual(Object.keys(schema.paths['/internal/routes/estimate'].post.responses['200'].content['application/json'].schema.properties.data.properties).sort(), ['distanceMeters', 'durationSeconds']);
  });
});
test('invalid tokens, scopes, DTO and correlation never reach provider', async () => {
  let calls = 0;
  await fixture(async url => {
    for (const [body, token, id, status] of [[input, '', undefined, 401], [input, 'gateway-test-token', undefined, 403], [{ ...input, unknown: 1 }, 'trip-test-token', undefined, 400], [input, 'trip-test-token', 'bad', 400], [{ ...input, vehicleType: 'BIKE' }, 'trip-test-token', undefined, 400]] as const) {
      const res = await post(url, body, token, undefined, id); assert.equal(res.status, status); assert.ok((await res.json()).error.code);
    }
    assert.equal(calls, 0); const health = await fetch(url + '/health/ready'); assert.equal(health.status, 200); assert.equal(calls, 0);
  }, { route: async () => { calls++; return { distanceMeters: 1, durationSeconds: 2, steps: [] }; }, matrix: async () => [] });
});
test('malformed/body-size/content-type errors are sanitized and external errors do not leak', async () => {
  await fixture(async url => {
    for (const [body, contentType, status] of [['{bad', 'application/json', 400], [JSON.stringify({ text: 'x'.repeat(66000) }), 'application/json', 413], ['{}', 'text/plain', 400]] as const) {
      const res = await fetch(url + '/routes', { method: 'POST', headers: { 'content-type': contentType }, body }); assert.equal(res.status, status); assert.equal((await res.json()).error.code, 'INVALID_REQUEST');
    }
    const res = await post(url, input); assert.equal(res.status, 500); assert.equal((await res.json()).error.message, 'INTERNAL_ERROR');
  }, { route: async () => { throw new Error('sensitive-token'); }, matrix: async () => [] });
});
test('Nest app.close invokes singleton pool shutdown and settles in-flight request', async () => {
  const runtime = new RoutingRuntime(config({ SHUTDOWN_GRACE_MS: '10' }), undefined, { route: () => new Promise(() => undefined), matrix: async () => [] });
  const app = await createApp(runtime); await app.listen(0, '127.0.0.1'); const response = post(await app.getUrl(), input);
  // Wait for the server to enter its provider rather than relying on a timing guess.
  for (let i = 0; i < 1000 && !runtime.pool.stats.running; i++) await tick();
  assert.equal(runtime.pool.stats.running, 1); await app.close(); assert.equal((await response).status, 503); assert.deepEqual(runtime.pool.stats, { accepting: false, running: 0, queued: 0 });
});
test('HTTP disconnect propagates cancellation and releases the worker', async () => {
  let entered!: () => void; const ready = new Promise<void>(r => { entered = r; }); let cancelled = false;
  await fixture(async (url, runtime) => {
    const controller = new AbortController();
    const pending = fetch(url + '/internal/routes/estimate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': 'trip-test-token' }, body: JSON.stringify(input), signal: controller.signal });
    const rejected = assert.rejects(pending); await ready; controller.abort(); await rejected;
    for (let i = 0; i < 1000 && runtime.pool.stats.running; i++) await tick();
    assert.equal(cancelled, true); assert.equal(runtime.pool.stats.running, 0);
  }, { route: async (_, context) => { entered(); await new Promise<void>(resolve => context.signal.addEventListener('abort', () => { cancelled = true; resolve(); }, { once: true })); return { distanceMeters: 1, durationSeconds: 1, steps: [] }; }, matrix: async () => [] });
});
