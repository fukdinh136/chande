import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeClient, MockRealtimeLocations } from '../../src/infrastructure/realtime/client';
import { systemClock } from '../../src/application/ports/clients';
import { config, context, point } from '../helpers/fixtures';
const source = [{ driverId: 'driver-original', location: point, observedAt: '2026-10-06T01:59:30Z' }];
test('Realtime preserves source IDs/locations/timestamps and empty is successful', async () => {
  let received: unknown;
  const client = new RealtimeClient({ findNearbyDriverLocations: async center => { received = center; return source; } }, config().realtime, systemClock);
  assert.deepEqual(await client.findNearbyDriverLocations(point, context()), source); assert.deepEqual(received, point);
  assert.deepEqual(await new RealtimeClient({ findNearbyDriverLocations: async () => [] }, config().realtime, systemClock).findNearbyDriverLocations(point, context()), []);
  const mock = new MockRealtimeLocations(systemClock); assert.equal(mock.radiusMeters, 2000); assert.equal((await mock.findNearbyDriverLocations(point, context())).length, 2);
});
test('invalid/duplicate snapshots and response cap fail, dependency errors never become empty', async () => {
  for (const raw of [[source[0]!, source[0]!], [{ ...source[0]!, observedAt: 'yesterday' }], [{ ...source[0]!, driverId: ' altered ' }]]) {
    const client = new RealtimeClient({ findNearbyDriverLocations: async () => raw }, config().realtime, systemClock);
    await assert.rejects(client.findNearbyDriverLocations(point, context()), /INVALID_REALTIME_RESPONSE/);
  }
  await assert.rejects(new RealtimeClient({ findNearbyDriverLocations: async () => source }, { ...config().realtime, maxResponse: 1 }, systemClock).findNearbyDriverLocations(point, context()), /INVALID_REALTIME_RESPONSE/);
  await assert.rejects(new RealtimeClient({ findNearbyDriverLocations: async () => { throw new Error('secret-body'); } }, config().realtime, systemClock).findNearbyDriverLocations(point, context()), (e: unknown) => e instanceof Error && e.message === 'REALTIME_UNAVAILABLE');
});
test('Realtime timeout is bounded and global timeout/cancellation takes priority', async () => {
  const client = new RealtimeClient({ findNearbyDriverLocations: () => new Promise(() => undefined) }, { ...config().realtime, timeout: 10 }, systemClock);
  await assert.rejects(client.findNearbyDriverLocations(point, context()), /REALTIME_DEADLINE_EXCEEDED/);
  const abort = new AbortController(); const pending = client.findNearbyDriverLocations(point, context(abort.signal)); abort.abort();
  await assert.rejects(pending, /ROUTING_DEADLINE_EXCEEDED/);
  await assert.rejects(client.findNearbyDriverLocations(point, { ...context(), deadline: performance.now() + 5 }), /ROUTING_DEADLINE_EXCEEDED/);
});
