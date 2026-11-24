import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CalculateEtaForOrigins } from '../../src/application/use-cases/eta-matrix';
import { WorkerPool } from '../../src/infrastructure/pipeline/pool';
import { systemClock, type MapProvider } from '../../src/application/ports/clients';
import { RoutingError } from '../../src/domain/errors';
import { config, point, context } from '../helpers/fixtures';
const origins = [0, 1, 2].map(i => ({ id: 'driver-' + i, lat: 10.77 + i / 1000, lng: 106.69 }));
const input = { destination: point, vehicleType: 'MOCK_BIKE', origins };
function fixture(provider: MapProvider, overrides = {}) {
  const limits = { ...config().limits, matrixBatch: 2, ...overrides };
  const pool = new WorkerPool(provider, { acquire: async () => undefined }, limits, systemClock);
  return { pool, useCase: new CalculateEtaForOrigins(pool, systemClock, ['MOCK_BIKE'], limits) };
}
const unexpected = async () => { throw new Error('unexpected route'); };
test('ETA for given origins: batches in order, keeps ids, asks nobody for driver locations', async () => {
  let batches = 0;
  const f = fixture({ route: unexpected, matrix: async request => {
    assert.deepEqual(request.destination, point);
    assert.deepEqual(request.origins, origins.slice(batches * 2, ++batches * 2).map(o => ({ lat: o.lat, lng: o.lng })));
    return request.origins.map((_, i) => i ? { status: 'NO_ROUTE', distanceMeters: null, durationSeconds: null } : { status: 'OK', distanceMeters: 10.2, durationSeconds: 2.1 });
  } });
  const result = await f.useCase.execute(input, context());
  assert.equal(batches, 2);
  assert.deepEqual(result.entries, [
    { id: 'driver-0', status: 'OK', distanceMeters: 11, durationSeconds: 3 },
    { id: 'driver-1', status: 'NO_ROUTE', distanceMeters: null, durationSeconds: null },
    { id: 'driver-2', status: 'OK', distanceMeters: 11, durationSeconds: 3 },
  ]);
  await f.pool.close();
});
test('ETA for given origins: invalid input and capacity never call the provider; a failed batch fails all', async () => {
  let maps = 0;
  const counting: MapProvider = { route: unexpected, matrix: async req => { maps++; return req.origins.map(() => ({ status: 'OK', distanceMeters: 1, durationSeconds: 1 })); } };
  const f = fixture(counting);
  for (const bad of [{ ...input, origins: [] }, { ...input, origins: [origins[0], origins[0]] }, { ...input, origins: Array.from({ length: 51 }, (_, i) => ({ id: 'd' + i, lat: 10, lng: 106 })) }, { ...input, pickup: point }])
    await assert.rejects(f.useCase.execute(bad, context()), /INVALID_REQUEST/);
  await assert.rejects(f.useCase.execute({ ...input, vehicleType: 'BUS' }, context()), /UNSUPPORTED_VEHICLE_TYPE/);
  await f.pool.close();
  const cap = fixture(counting, { matrixCandidates: 2 });
  await assert.rejects(cap.useCase.execute(input, context()), /ROUTING_BUSY/); await cap.pool.close();
  assert.equal(maps, 0);
  let calls = 0;
  const failed = fixture({ route: unexpected, matrix: async req => { if (++calls === 2) throw new RoutingError('PROVIDER_UNAVAILABLE', 503); return req.origins.map(() => ({ status: 'OK', distanceMeters: 1, durationSeconds: 1 })); } });
  await assert.rejects(failed.useCase.execute(input, context()), /PROVIDER_UNAVAILABLE/); await failed.pool.close();
});
