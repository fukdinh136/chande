import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from '../../src/api/http';
import { RoutingRuntime } from '../../src/bootstrap/runtime';
import { config, point, context } from '../helpers/fixtures';
import type { MapProvider } from '../../src/application/ports/clients';
import { RoutingError } from '../../src/domain/errors';
const moduleAt = (file: string) => import(pathToFileURL(resolve('../trip-service/dist', file)).href);
async function fixture(run: (url: string) => Promise<void>, provider?: MapProvider) {
  const app = await createApp(new RoutingRuntime(config({ SHUTDOWN_GRACE_MS: '10' }), undefined, provider)); await app.listen(0, '127.0.0.1');
  try { await run(await app.getUrl()); } finally { await app.close(); }
}
test('actual Trip RoutingClient consumes strict estimate from Routing HTTP', async () => {
  const { RoutingClient } = await moduleAt('infrastructure/clients/routing.js'); const { JsonHttpClient } = await moduleAt('infrastructure/clients/http.js');
  await fixture(async url => {
    const client = new RoutingClient(new JsonHttpClient(url, 'trip-test-token', 1000));
    assert.deepEqual(await client.estimate(point, point, 'MOCK_BIKE', context().requestId), { distanceMeters: 4000, durationSeconds: 600 });
  });
});
test('actual Trip EstimateTrip creates no quote and does not call Pricing on Routing failure/timeout', async () => {
  const { RoutingClient } = await moduleAt('infrastructure/clients/routing.js'); const { JsonHttpClient } = await moduleAt('infrastructure/clients/http.js'); const { EstimateTrip } = await moduleAt('application/use-cases/estimate.js');
  const providers: MapProvider[] = [{ route: async () => { throw new RoutingError('NO_ROUTE', 422); }, matrix: async () => [] }, { route: () => new Promise(() => undefined), matrix: async () => [] }];
  for (const provider of providers) {
    await fixture(async url => {
      let transactions = 0; let prices = 0;
      const client = new RoutingClient(new JsonHttpClient(url, 'trip-test-token', 30));
      const useCase = new EstimateTrip({ transaction: async () => { transactions++; } }, client, { estimate: async () => { prices++; } }, { now: () => new Date(), id: () => context().requestId }, ['MOCK_BIKE']);
      await assert.rejects(useCase.execute({ role: 'RIDER', sub: 'rider-a' }, { pickup: point, destination: point, vehicleType: 'MOCK_BIKE' }, context().requestId), { code: 'DEPENDENCY_UNAVAILABLE' });
      assert.equal(transactions, 0); assert.equal(prices, 0);
    }, provider);
  }
});
