import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/api/http';
import { RoutingRuntime } from '../../src/bootstrap/runtime';
import { config, point } from '../helpers/fixtures';
import { MockMapProvider } from '../../src/infrastructure/map/mock';
import { systemClock } from '../../src/application/ports/clients';
test('recalculate uses currentLocation as origin, preserves destination/steps and Gateway scope', async () => {
  let calls = 0; const map = new MockMapProvider(systemClock);
  const currentLocation = { lat: 10.79, lng: 106.71 };
  const runtime = new RoutingRuntime(config(), undefined, { route: async (input, ctx) => {
    calls++; assert.deepEqual(input.origin, currentLocation); assert.deepEqual(input.destination, point); assert.equal(input.full, true); assert.equal(input.includeSteps, true); return map.route(input, ctx);
  }, matrix: async () => { throw new Error('unexpected matrix'); } }, { findNearbyDriverLocations: async () => { throw new Error('unexpected realtime'); } });
  const app = await createApp(runtime); await app.listen(0, '127.0.0.1'); const url = await app.getUrl();
  const post = (token: string, body: unknown) => fetch(url + '/routes/recalculate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': token }, body: JSON.stringify(body) });
  try {
    const input = { currentLocation, destination: point, vehicleType: 'MOCK_BIKE', includeSteps: true };
    assert.equal((await post('matching-test-token', input)).status, 403); assert.equal((await post('gateway-test-token', { ...input, tripId: 'trip' })).status, 400); assert.equal(calls, 0);
    const res = await post('gateway-test-token', input); assert.equal(res.status, 200); const body = await res.json(); assert.ok(body.data.polyline.value); assert.equal(body.data.vehicleType, 'MOCK_BIKE'); assert.equal(calls, 1);
  } finally { await app.close(); }
});
