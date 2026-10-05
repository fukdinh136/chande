import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, rank, type Offer, type Search } from '../src/domain/models';
const id = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
test('accept before deadline, exact boundary/ownership/terminal rejected', () => {
  const offer = { offerId: id, driverId: id, status: 'PENDING', expiresAt: new Date(20000).toISOString() } as Offer;
  const search = { offerId: id, status: 'SEARCHING' } as Search;
  assert.equal(decide(offer, search, id, 'accept', 19999), 'ASSIGNMENT_PENDING');
  assert.equal(decide(offer, search, id, 'decline', 19999), 'DECLINED');
  assert.throws(() => decide(offer, search, id, 'accept', 20000));
  assert.throws(() => decide(offer, search, other, 'accept', 0), /FORBIDDEN/);
  assert.throws(() => decide(offer, { ...search, status: 'CANCELLED' }, id, 'accept', 0));
});
test('rank ETA then distance then id; excludes stale, no-route, tried and held', () => {
  const c = (driverId: string, durationSeconds: number) => ({ driverId, durationSeconds, distanceMeters: 100, observedAt: new Date(50000).toISOString(), status: 'OK' as const });
  assert.deepEqual(rank([c(other, 10), c(id, 10)], new Set(), new Set(), 50000).map(x => x.driverId), [id, other]);
  assert.equal(rank([c(id, 1)], new Set([id]), new Set(), 50000).length, 0);
  assert.equal(rank([c(id, 1)], new Set(), new Set([id]), 50000).length, 0);
  assert.equal(rank([c(id, 1)], new Set(), new Set(), 80001).length, 0);
  assert.equal(rank([{ ...c(id, 1), status: 'NO_ROUTE', durationSeconds: null, distanceMeters: null }], new Set(), new Set(), 50000).length, 0);
});
