import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../../src/api/app';
import { loadConfig } from '../../src/bootstrap/config';
test('Price HTTP matches Trip envelope, auth, DTO, correlation and body bounds', async () => {
  const app = await createApi(loadConfig({ PRICE_TRIP_TOKEN: 'test-price-token', SWAGGER_ENABLED: 'true' })); await app.listen(0, '127.0.0.1'); const url = await app.getUrl();
  const id = '90000000-0000-4000-8000-000000000001'; const input = { route: { distanceMeters: 4000, durationSeconds: 600 }, vehicleType: 'CAR' };
  const post = (body: unknown, token = 'test-price-token', requestId = id) => fetch(url + '/internal/fares/estimate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': token, 'x-request-id': requestId }, body: JSON.stringify(body) });
  try {
    const response = await post(input); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { data: { currency: 'VND', amount: '42000', breakdown: [{ code: 'BASE_FARE', amount: '12000' }, { code: 'DISTANCE_FARE', amount: '30000' }] }, meta: { requestId: id } });
    assert.equal((await post(input, 'bad')).status, 401); assert.equal((await post(input, undefined, 'bad')).status, 400); assert.equal((await post({ ...input, eta: 600 })).status, 400);
    assert.equal((await post({ text: 'x'.repeat(66000) })).status, 413);
    assert.equal((await fetch(url + '/health/ready')).status, 200); assert.equal((await fetch(url + '/openapi.json')).status, 200);
  } finally { await app.close(); }
});
