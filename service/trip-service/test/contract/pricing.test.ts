import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonHttpClient } from '../../src/infrastructure/clients/http';
import { PricingClient } from '../../src/infrastructure/clients/pricing';
import { quote } from '../fixtures';
import { envelope, withServer } from '../http-server';
const requestId = '90000000-0000-4000-8000-000000000001';
test('Pricing preserves decimal-string money and uses route plus vehicle type', async () => {
  await withServer((req, body) => { assert.equal(req.url, '/internal/fares/estimate'); assert.deepEqual(body.route, quote().route); return { body: envelope(quote().fare, requestId) }; }, async url => {
    assert.deepEqual(await new PricingClient(new JsonHttpClient(url, 'x', 1000)).estimate(quote().route, 'MOCK_BIKE', requestId), quote().fare);
  });
});
test('Pricing rejects numeric money, overflow, unsupported currency and inconsistent breakdown', async () => {
  for (const fare of [{ ...quote().fare, amount: 45000 }, { ...quote().fare, amount: '9223372036854775808' }, { ...quote().fare, currency: 'USD' }, { ...quote().fare, amount: '45001' }]) await withServer(() => ({ body: envelope(fare, requestId) }), async url => {
    await assert.rejects(new PricingClient(new JsonHttpClient(url, 'x', 1000)).estimate(quote().route, 'MOCK_BIKE', requestId), { code: 'DEPENDENCY_UNAVAILABLE' });
  });
});
