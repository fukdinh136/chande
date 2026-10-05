import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonHttpClient } from '../../src/infrastructure/clients/http';
import { RoutingClient } from '../../src/infrastructure/clients/routing';
import { quote } from '../fixtures';
import { envelope, withServer } from '../http-server';
const requestId = '90000000-0000-4000-8000-000000000001';
test('Routing sends normalized inputs, correlation and service credential', async () => {
  await withServer((req, body) => {
    assert.equal(req.url, '/internal/routes/estimate'); assert.equal(req.headers['x-service-token'], 'routing-only');
    assert.equal(body.vehicleType, 'MOCK_BIKE'); assert.deepEqual(body.pickup, quote().pickup);
    return { body: envelope(quote().route, req.headers['x-request-id']) };
  }, async url => { assert.deepEqual(await new RoutingClient(new JsonHttpClient(url, 'routing-only', 1000)).estimate(quote().pickup, quote().destination, 'MOCK_BIKE', requestId), quote().route); });
});
test('Routing rejects invalid upstream data and errors', async () => {
  for (const response of [{ body: envelope({ distanceMeters: -1, durationSeconds: 1 }, requestId) }, { status: 503, body: {} }]) await withServer(() => response, async url => {
    await assert.rejects(new RoutingClient(new JsonHttpClient(url, 'x', 1000)).estimate(quote().pickup, quote().destination, 'MOCK_BIKE', requestId), { code: 'DEPENDENCY_UNAVAILABLE' });
  });
});
test('Routing times out a stalled HTTP request without creating business state', async () => {
  await withServer(async () => { await new Promise(resolve => setTimeout(resolve, 100)); return { body: envelope(quote().route, requestId) }; }, async url => {
    await assert.rejects(new RoutingClient(new JsonHttpClient(url, 'x', 20)).estimate(quote().pickup, quote().destination, 'MOCK_BIKE', requestId), { code: 'DEPENDENCY_UNAVAILABLE' });
  });
});
