import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Trip } from '../../src/domain/trip';
import { assertUsableQuote, validateEstimate } from '../../src/domain/quote';
import { assignment, driver, now, quote, rider } from '../fixtures';
const id = '20000000-0000-4000-8000-000000000001';
const searching = () => Trip.create(id, quote(), rider.sub, now).search(now).trip;
test('immutable snapshots and fixed fare through complete lifecycle', () => {
  let trip = searching(); const copy = trip.snapshot(); copy.fare.estimatedAmount = '1';
  assert.equal(trip.snapshot().fare.estimatedAmount, '45000');
  trip = trip.assign(assignment(), now).trip;
  trip = trip.update(driver, 'DRIVER_ARRIVED', 2, now).trip;
  trip = trip.update(driver, 'IN_PROGRESS', 3, now).trip;
  trip = trip.update(driver, 'COMPLETED', 4, now).trip;
  assert.equal(trip.snapshot().fare.finalAmount, '45000'); assert.equal(trip.snapshot().version, 5);
  assert.throws(() => trip.cancel(rider, 'late', 5, now), { code: 'INVALID_TRANSITION' });
});
test('only owner or assigned driver can act; rider cannot drive', () => {
  const trip = searching().assign(assignment(), now).trip;
  assert.throws(() => trip.update(rider, 'DRIVER_ARRIVED', 2, now), { code: 'FORBIDDEN_ACTION' });
  assert.throws(() => trip.cancel({ ...driver, sub: 'other' }, 'x', 2, now), { code: 'RESOURCE_NOT_FOUND' });
  assert.throws(() => searching().cancel(driver, 'x', 1, now), { code: 'RESOURCE_NOT_FOUND' });
});
test('version conflicts and skipped steps do not change Trip', () => {
  const trip = searching().assign(assignment(), now).trip;
  assert.throws(() => trip.update(driver, 'DRIVER_ARRIVED', 1, now), { code: 'VERSION_CONFLICT' });
  assert.throws(() => trip.update(driver, 'IN_PROGRESS', 2, now), { code: 'INVALID_TRANSITION' });
  assert.equal(trip.snapshot().version, 2);
});
test('rider and assigned driver cancel before start without fee or rematching', () => {
  assert.equal(searching().cancel(rider, 'changed', 1, now).trip.snapshot().status, 'CANCELLED');
  const trip = searching().assign(assignment(), now).trip.update(driver, 'DRIVER_ARRIVED', 2, now).trip;
  const cancelled = trip.cancel(driver, 'cannot continue', 3, now).trip;
  assert.equal(cancelled.snapshot().fare.finalAmount, null);
  assert.throws(() => cancelled.search(now), { code: 'INVALID_TRANSITION' });
  assert.throws(() => cancelled.assign(assignment(), now), { code: 'TRIP_ALREADY_ASSIGNED' });
});
test('quote owner, single use and exact expiry boundary are enforced', () => {
  assertUsableQuote(quote(), rider.sub, new Date(+now + 299999));
  assert.throws(() => assertUsableQuote(quote(), rider.sub, new Date(+now + 300000)), { code: 'QUOTE_EXPIRED' });
  assert.throws(() => assertUsableQuote(quote(), 'other', now), { code: 'RESOURCE_NOT_FOUND' });
  assert.throws(() => assertUsableQuote({ ...quote(), consumedTripId: id }, rider.sub, now), { code: 'QUOTE_ALREADY_USED' });
});
test('fare is precise and invalid dependency results cannot become quotes', () => {
  validateEstimate(quote().route, quote().fare);
  assert.throws(() => validateEstimate(quote().route, { ...quote().fare, amount: '45001' }), { code: 'INVALID_FARE' });
  assert.throws(() => validateEstimate({ distanceMeters: -1, durationSeconds: 1 }, quote().fare), { code: 'INVALID_ROUTE' });
});
test('SEARCHING remains active after a long wait; no time-based transition exists', () => {
  const trip = searching();
  assert.equal(trip.snapshot().status, 'SEARCHING');
  assert.equal(trip.cancel(rider, 'stop waiting', 1, new Date(+now + 86400000)).trip.snapshot().status, 'CANCELLED');
});
