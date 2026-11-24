import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationSchema, measurement, requireVehicle } from '../../src/domain/models';
test('coordinates reject bounds, nonfinite values and unknown fields', () => {
  for (const lat of [-91, 91, NaN, Infinity]) assert.equal(locationSchema.safeParse({ lat, lng: 10 }).success, false);
  for (const lng of [-181, 181, NaN]) assert.equal(locationSchema.safeParse({ lat: 10, lng }).success, false);
  assert.equal(locationSchema.safeParse({ lat: 90, lng: -180 }).success, true);
  assert.equal(locationSchema.safeParse({ lat: 10, lng: 20, extra: true }).success, false);
});
test('measurements round upwards, preserve zero and reject overflow', () => {
  assert.equal(measurement(0), 0); assert.equal(measurement(1.1), 2);
  for (const x of [-1, Infinity, NaN, 2147483647.1, '10', null]) assert.throws(() => measurement(x), /INVALID_PROVIDER_RESPONSE/);
});
test('unsupported vehicle types are rejected', () => {
  assert.throws(() => requireVehicle('BIKE', ['MOCK_BIKE']), /UNSUPPORTED_VEHICLE_TYPE/);
});
