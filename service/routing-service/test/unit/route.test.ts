import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CalculateRoute } from '../../src/application/use-cases/route';
import { WorkerPool } from '../../src/infrastructure/pipeline/pool';
import { MockMapProvider } from '../../src/infrastructure/map/mock';
import { systemClock } from '../../src/application/ports/clients';
import { RoutingError } from '../../src/domain/errors';
import { config, context, point } from '../helpers/fixtures';
const input = { pickup: point, destination: point, vehicleType: 'MOCK_BIKE' };
test('estimate returns exactly two integers while full route returns geometry', async () => {
  const pool = new WorkerPool(new MockMapProvider(systemClock), { acquire: async () => undefined }, config().limits, systemClock);
  const useCase = new CalculateRoute(pool, systemClock, ['MOCK_BIKE']);
  assert.deepEqual(await useCase.estimate(input, context()), { distanceMeters: 4000, durationSeconds: 600 });
  const full = await useCase.full({ origin: point, destination: point, vehicleType: 'MOCK_BIKE' }, context()); assert.equal(full.polyline.precision, 6); assert.equal(full.steps.length, 0);
  await pool.close();
});
test('invalid input and unsupported vehicle fail before dispatch; provider failure propagates', async () => {
  let calls = 0;
  const pool = new WorkerPool({ route: async () => { calls++; throw new RoutingError('NO_ROUTE', 422); }, matrix: async () => [] }, { acquire: async () => undefined }, config().limits, systemClock);
  const useCase = new CalculateRoute(pool, systemClock, ['MOCK_BIKE']);
  await assert.rejects(useCase.estimate({ ...input, pickup: { lat: 91, lng: 0 } }, context()), /INVALID_REQUEST/);
  await assert.rejects(useCase.estimate({ ...input, vehicleType: 'BIKE' }, context()), /UNSUPPORTED_VEHICLE_TYPE/); assert.equal(calls, 0);
  await assert.rejects(useCase.estimate(input, context()), /NO_ROUTE/); assert.equal(calls, 1); await pool.close();
});
