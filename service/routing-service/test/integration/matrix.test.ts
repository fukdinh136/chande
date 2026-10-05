import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/api/http';
import { RoutingRuntime } from '../../src/bootstrap/runtime';
import { config, point } from '../helpers/fixtures';
test('HTTP matrix accepts pickup/profile only, calls Realtime then map and requires Matching scope', async () => {
  let calls = 0;
  const runtime = new RoutingRuntime(config(), undefined, undefined, { findNearbyDriverLocations: async center => { assert.deepEqual(center, point); calls++; return [{ driverId: 'driver-a', location: point, observedAt: '2026-10-06T01:59:00Z' }]; } });
  const app = await createApp(runtime); await app.listen(0, '127.0.0.1'); const url = await app.getUrl();
  const post = (token: string, body: unknown) => fetch(url + '/routes/matrix', { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': token }, body: JSON.stringify(body) });
  try {
    const input = { pickup: point, vehicleType: 'MOCK_BIKE' }; assert.equal((await post('trip-test-token', input)).status, 403);
    assert.equal((await post('matching-test-token', { ...input, candidates: [] })).status, 400); assert.equal(calls, 0);
    const response = await post('matching-test-token', input); assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.data.entries[0].driverId, 'driver-a'); assert.equal(result.data.entries[0].observedAt, '2026-10-06T01:59:00Z'); assert.equal(result.data.radiusMeters, 2000); assert.equal(calls, 1);
  } finally { await app.close(); }
});
test('app.close also cancels Realtime lookup before it has entered the map queue', async () => {
  let entered!: () => void; const ready = new Promise<void>(r => { entered = r; });
  const runtime = new RoutingRuntime(config({ SHUTDOWN_GRACE_MS: '10' }), undefined, undefined, { findNearbyDriverLocations: () => { entered(); return new Promise(() => undefined); } });
  const app = await createApp(runtime); await app.listen(0, '127.0.0.1');
  const request = fetch(await app.getUrl() + '/routes/matrix', { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': 'matching-test-token' }, body: JSON.stringify({ pickup: point, vehicleType: 'MOCK_BIKE' }) });
  await ready; assert.equal(runtime.pool.stats.running, 0); await app.close(); assert.equal((await request).status, 503);
});
