import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/api/http';
import { RoutingRuntime } from '../../src/bootstrap/runtime';
import { config, point } from '../helpers/fixtures';
test('HTTP eta-matrix takes origins from Matching and requires Matching scope', async () => {
  const runtime = new RoutingRuntime(config());
  const app = await createApp(runtime); await app.listen(0, '127.0.0.1'); const url = await app.getUrl();
  const post = (token: string, body: unknown) => fetch(url + '/internal/routes/eta-matrix', { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': token }, body: JSON.stringify(body) });
  try {
    const input = { destination: point, vehicleType: 'MOCK_BIKE', origins: [{ id: 'driver-a', lat: point.lat, lng: point.lng }] };
    assert.equal((await post('trip-test-token', input)).status, 403);
    assert.equal((await post('matching-test-token', { ...input, origins: [] })).status, 400);
    const response = await post('matching-test-token', input); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.data.entries.length, 1); assert.equal(result.data.entries[0].id, 'driver-a'); assert.ok(result.data.calculatedAt);
  } finally { await app.close(); }
});
