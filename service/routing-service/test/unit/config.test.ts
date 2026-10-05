import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig as readConfig } from '../../src/bootstrap/config';
const mockProfiles = JSON.stringify({ schemaVersion: 1, vehicleTypes: { MOCK_BIKE: { profile: 'mock_motorcycle', baseUrl: null } } });
const loadConfig: typeof readConfig = (env, options) => readConfig(env, { read: () => mockProfiles, ...options });
export const testEnv = { APP_ENV: 'test', ROUTING_TRIP_TOKEN: 'test-trip-token', ROUTING_MATCHING_TOKEN: 'test-matching-token', ROUTING_GATEWAY_TOKEN: 'test-gateway-token' };
const profiles = JSON.stringify({ schemaVersion: 1, vehicleTypes: { CAR: { profile: 'driving', baseUrl: null } } });
test('mock defaults preserve bounded queue, radius and separate integrations', () => {
  const c = loadConfig(testEnv); assert.equal(c.map.mode, 'mock'); assert.equal(c.realtime.mode, 'mock');
  assert.equal(c.realtime.radius, 2000); assert.equal(c.limits.workers, 2); assert.equal(c.limits.deadline, 4000);
});
test('native OSRM real mode needs endpoint/profile but not API key', () => {
  const c = loadConfig({ ...testEnv, INTEGRATION_MODE: 'real', SUPPORTED_VEHICLE_TYPES: 'CAR', EXTERNAL_MAP_BASE_URL: 'http://localhost:5000', EXTERNAL_MAP_ALLOW_HTTP: 'true' }, { read: () => profiles });
  assert.equal(c.map.key, ''); assert.equal(c.profiles.CAR?.baseUrl, 'http://localhost:5000');
});
test('reject unsupported modes, empty profiles, URL credentials and unsafe hosts', () => {
  for (const env of [{ INTEGRATION_MODE: 'bad' }, { SUPPORTED_VEHICLE_TYPES: 'BIKE' }, { EXTERNAL_MAP_BASE_URL: 'https://secret@example.com' }, { EXTERNAL_MAP_BASE_URL: 'https://evil.example' }, { INTEGRATION_MODE: 'real' }]) assert.throws(() => loadConfig({ ...testEnv, ...env }), /^Error: Invalid configuration:/);
});
test('header map auth requires HTTPS and its own key; errors do not leak values', () => {
  const env = { ...testEnv, INTEGRATION_MODE: 'real', SUPPORTED_VEHICLE_TYPES: 'CAR', EXTERNAL_MAP_AUTH_MODE: 'header', EXTERNAL_MAP_BASE_URL: 'https://localhost' };
  assert.throws(() => loadConfig(env, { read: () => profiles }), /EXTERNAL_MAP_API_KEY/);
  assert.throws(() => loadConfig({ ...env, EXTERNAL_MAP_API_KEY: 'sensitive-key', EXTERNAL_MAP_BASE_URL: 'http://localhost', EXTERNAL_MAP_ALLOW_HTTP: 'true' }, { read: () => profiles }), (e: unknown) => e instanceof Error && !e.message.includes('sensitive-key'));
  assert.equal(loadConfig({ ...env, EXTERNAL_MAP_API_KEY: 'sensitive-key' }, { read: () => profiles }).map.auth, 'header');
});
test('secret files trim input, reject ambiguous sources and sanitize read errors', () => {
  assert.equal(loadConfig({ ...testEnv, ROUTING_TRIP_TOKEN: '', ROUTING_TRIP_TOKEN_FILE: 'test-secret' }, { read: f => f.endsWith('test-secret') ? ' file-token\n' : JSON.stringify({ schemaVersion: 1, vehicleTypes: { MOCK_BIKE: { profile: 'mock_motorcycle', baseUrl: null } } }) }).tokens.trip, 'file-token');
  assert.throws(() => loadConfig({ ...testEnv, ROUTING_TRIP_TOKEN_FILE: 'secret' }), /ROUTING_TRIP_TOKEN/);
  assert.throws(() => loadConfig({ ...testEnv, ROUTING_TRIP_TOKEN: '', ROUTING_TRIP_TOKEN_FILE: 'secret' }, { read: () => { throw new Error('sensitive content'); } }), (e: unknown) => e instanceof Error && !e.message.includes('sensitive content'));
});
test('reject invalid numeric limits and string boolean traps', () => {
  for (const env of [{ QUEUE_MAX_SIZE: '0' }, { PORT: '65536' }, { WORKER_POOL_SIZE: '-1' }, { REQUEST_DEADLINE_MS: '5000' }, { UPSTREAM_TIMEOUT_MS: 'NaN' }, { SWAGGER_ENABLED: 'yes' }, { NEARBY_DRIVER_RADIUS_METERS: '1000' }]) assert.throws(() => loadConfig({ ...testEnv, ...env }));
  assert.equal(loadConfig({ ...testEnv, SWAGGER_ENABLED: 'false' }).swagger, false);
});
test('distinct caller credentials and production real modes are required', () => {
  assert.throws(() => loadConfig({ ...testEnv, ROUTING_GATEWAY_TOKEN: testEnv.ROUTING_TRIP_TOKEN }), /ROUTING_SERVICE_TOKENS/);
  assert.throws(() => loadConfig({ ...testEnv, APP_ENV: 'production' }), /INTEGRATION_MODE/);
});
test('Realtime mode and credential remain independent of OSRM', () => {
  assert.throws(() => loadConfig({ ...testEnv, REALTIME_INTEGRATION_MODE: 'real' }), /REALTIME_BASE_URL/);
  const c = loadConfig({ ...testEnv, REALTIME_INTEGRATION_MODE: 'real', REALTIME_BASE_URL: 'https://realtime.internal', REALTIME_TOKEN: 'test-realtime-token' });
  assert.equal(c.map.mode, 'mock'); assert.equal(c.realtime.token, 'test-realtime-token');
});
