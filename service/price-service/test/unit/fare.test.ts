import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FarePolicy } from '../../src/domain/fare';
import { CalculateFare } from '../../src/application/calculate';
import { loadConfig } from '../../src/bootstrap/config';
const policy = JSON.parse(readFileSync('config/fare-policy.example.json', 'utf8'));
const input = (distanceMeters: number, vehicleType = 'BIKE', durationSeconds = 600) => ({ route: { distanceMeters, durationSeconds }, vehicleType });
test('sample CAR/BIKE policies calculate opening and excess distance separately', () => {
  const fare = new CalculateFare(new FarePolicy(policy), ['CAR', 'BIKE']);
  assert.equal(fare.execute(input(4000, 'CAR')).amount, '42000'); assert.equal(fare.execute(input(4000)).amount, '20000');
  for (const meters of [0, 999, 1000]) assert.equal(fare.execute(input(meters)).amount, '8000');
  assert.equal(fare.execute(input(1001)).amount, '8004'); assert.equal(fare.execute(input(4000, 'BIKE', 1200)).amount, '20000');
});
test('integer arithmetic rounds partial VND and snapshots mutable input config', () => {
  const config = structuredClone(policy); config.vehicleTypes.BIKE.pricePerKmVnd = '1001'; const fare = new FarePolicy(config);
  config.vehicleTypes.BIKE.openingFareVnd = '99999'; const result = fare.calculate(input(1001)); assert.equal(result.amount, '8002');
  assert.equal(result.breakdown.reduce((total, line) => total + BigInt(line.amount), 0n), BigInt(result.amount));
});
test('invalid requests, unknown vehicle and money overflow fail closed', () => {
  const fare = new CalculateFare(new FarePolicy(policy), ['CAR', 'BIKE']);
  for (const value of [input(-1), input(NaN), input(1.5), { ...input(1), unknown: true }, input(1, 'TRUCK')]) assert.throws(() => fare.execute(value));
  const overflow = structuredClone(policy); overflow.vehicleTypes.BIKE.openingFareVnd = '9223372036854775807'; assert.throws(() => new FarePolicy(overflow).calculate(input(1001)), /INVALID_FARE/);
});
test('settings validate token/file, enabled policy and port without leaking secrets', () => {
  assert.equal(loadConfig({ PRICE_TRIP_TOKEN: 'test-token' }).port, 3005);
  for (const env of [{}, { PRICE_TRIP_TOKEN: 'test-token', PRICE_TRIP_TOKEN_FILE: 'secret' }, { PRICE_TRIP_TOKEN: 'test-token', PORT: '0' }, { PRICE_TRIP_TOKEN: 'test-token', SUPPORTED_VEHICLE_TYPES: 'UNKNOWN' }]) assert.throws(() => loadConfig(env));
  assert.throws(() => loadConfig({ PRICE_TRIP_TOKEN_FILE: 'missing' }, () => { throw new Error('sensitive'); }), (e: unknown) => e instanceof Error && !e.message.includes('sensitive'));
});
test('policy rejects malformed money and unsupported billing configuration', () => {
  for (const value of [null, '-1', '01', 'not-money', '9223372036854775808']) {
    const invalid = structuredClone(policy); invalid.vehicleTypes.BIKE.pricePerKmVnd = value;
    assert.throws(() => loadConfig({ PRICE_TRIP_TOKEN: 'test-token' }, () => JSON.stringify(invalid)), /Invalid configuration: FARE_POLICY_FILE/);
  }
});
