import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CalculateEtaMatrix } from '../../src/application/use-cases/matrix';
import { WorkerPool } from '../../src/infrastructure/pipeline/pool';
import { systemClock, type MapProvider, type RealtimeLocationPort } from '../../src/application/ports/clients';
import { RoutingError } from '../../src/domain/errors';
import { config, point, context } from '../helpers/fixtures';
const drivers = [0, 1, 2].map(i => ({ driverId: 'driver-' + i, location: { lat: 10.77 + i / 1000, lng: 106.69 }, observedAt: '2026-10-06T01:59:00Z' }));
const input = { pickup: point, vehicleType: 'MOCK_BIKE' };
function fixture(realtime: RealtimeLocationPort, provider: MapProvider, overrides = {}, clock = systemClock) {
  const limits = { ...config().limits, matrixBatch: 2, ...overrides };
  const pool = new WorkerPool(provider, { acquire: async () => undefined }, limits, clock);
  return { pool, useCase: new CalculateEtaMatrix(realtime, pool, clock, ['MOCK_BIKE'], limits) };
}
test('ETA obtains origins from Realtime, preserves batch identity/order/timestamp, never ranks', async () => {
  let batches = 0;
  const f = fixture({ findNearbyDriverLocations: async (center, ctx) => { assert.deepEqual(center, point); assert.ok(ctx.deadline); return drivers; } }, {
    route: async () => { throw new Error('unexpected route'); }, matrix: async request => {
      assert.deepEqual(request.destination, point); assert.deepEqual(request.origins, drivers.slice(batches * 2, ++batches * 2).map(d => d.location));
      return request.origins.map((_, i) => i ? { status: 'NO_ROUTE', distanceMeters: null, durationSeconds: null } : { status: 'OK', distanceMeters: 10, durationSeconds: 2 });
    },
  });
  const result = await f.useCase.execute(input, context()); assert.equal(batches, 2); assert.equal(result.radiusMeters, 2000); assert.equal(result.hasReachableCandidate, true);
  assert.deepEqual(result.entries.map(e => ({ driverId: e.driverId, location: e.location, observedAt: e.observedAt })), drivers); assert.equal(result.entries[1]!.status, 'NO_ROUTE'); await f.pool.close();
});
test('empty, capacity overflow, lookup failures and invalid DTO never call OSRM', async () => {
  let maps = 0;
  const provider: MapProvider = { route: async () => { throw new Error('unexpected'); }, matrix: async () => { maps++; return []; } };
  const f = fixture({ findNearbyDriverLocations: async () => [] }, provider); assert.equal((await f.useCase.execute(input, context())).entries.length, 0); await f.pool.close();
  const cap = fixture({ findNearbyDriverLocations: async () => drivers }, provider, { matrixCandidates: 2 }); await assert.rejects(cap.useCase.execute(input, context()), /ROUTING_BUSY/); await cap.pool.close();
  const failed = fixture({ findNearbyDriverLocations: async () => { throw new RoutingError('REALTIME_UNAVAILABLE', 503); } }, provider);
  await assert.rejects(failed.useCase.execute(input, context()), /REALTIME_UNAVAILABLE/);
  await assert.rejects(failed.useCase.execute({ ...input, candidates: [] }, context()), /INVALID_REQUEST/); await failed.pool.close(); assert.equal(maps, 0);
});
test('all null cells succeed; a failed batch or wrong shape fails entire matrix', async () => {
  let calls = 0;
  const f = fixture({ findNearbyDriverLocations: async () => drivers }, { route: async () => { throw new Error('unexpected'); }, matrix: async req => req.origins.map(() => ({ status: 'NO_ROUTE', distanceMeters: null, durationSeconds: null })) });
  assert.equal((await f.useCase.execute(input, context())).hasReachableCandidate, false); await f.pool.close();
  const failed = fixture({ findNearbyDriverLocations: async () => drivers }, { route: async () => { throw new Error('unexpected'); }, matrix: async req => { if (++calls === 2) throw new RoutingError('PROVIDER_UNAVAILABLE', 503); return req.origins.map(() => ({ status: 'OK', distanceMeters: 1, durationSeconds: 1 })); } });
  await assert.rejects(failed.useCase.execute(input, context()), /PROVIDER_UNAVAILABLE/); await failed.pool.close();
  const shape = fixture({ findNearbyDriverLocations: async () => drivers }, { route: async () => { throw new Error('unexpected'); }, matrix: async () => [] });
  await assert.rejects(shape.useCase.execute(input, context()), /INVALID_PROVIDER_RESPONSE/); await shape.pool.close();
});
test('Realtime latency consumes the shared deadline before any matrix dispatch', async () => {
  let now = 0; let maps = 0; const clock = { now: () => now, iso: () => '2026-10-06T02:00:00Z' };
  const f = fixture({ findNearbyDriverLocations: async () => { now = 4001; return drivers; } }, { route: async () => { throw new Error('unexpected'); }, matrix: async () => { maps++; return []; } }, {}, clock);
  await assert.rejects(f.useCase.execute(input, { ...context(), deadline: 4000 }), /ROUTING_DEADLINE_EXCEEDED/); assert.equal(maps, 0); await f.pool.close();
});
