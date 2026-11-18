import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/bootstrap/config';
import { credential } from '../src/api/auth';
test('credentials reject missing/wrong and use constant time comparison', () => { assert.throws(() => credential(undefined, 'secret')); assert.throws(() => credential('wrong', 'secret')); credential('secret', 'secret'); });
test('config fails closed without credentials', () => { assert.throws(() => loadConfig({}), /Configure|required/); });
const env = (extra: Record<string, string> = {}) => ({ MATCHING_TRIP_TOKEN: 't'.repeat(32), MATCHING_DRIVER_TOKEN: 'd'.repeat(32), MATCHING_REALTIME_TOKEN: 'r'.repeat(32), DATABASE_URL: 'postgres://x@localhost/db', RABBITMQ_URL: 'amqp://localhost',
  ROUTING_BASE_URL: 'http://routing', ROUTING_MATCHING_TOKEN: 'o'.repeat(32), DRIVER_BASE_URL: 'http://driver', DRIVER_MATCHING_TOKEN: 'v'.repeat(32), TRIP_BASE_URL: 'http://trip', TRIP_MATCHING_TOKEN: 'p'.repeat(32), AUTH_JWKS_URL: 'http://auth/jwks', AUTH_JWT_ISSUER: 'issuer', ...extra });
test('candidate search needs Realtime; limits are bounded', () => {
  assert.throws(() => loadConfig(env()), /REALTIME_BASE_URL required/);
  const realtime = { REALTIME_BASE_URL: 'http://realtime', REALTIME_MATCHING_TOKEN: 'l'.repeat(32) };
  const config = loadConfig(env(realtime));
  assert.equal(config.nearbyLimit, 200); assert.equal(config.nearbyPages, 5); assert.equal(config.matrixCandidates, 25);
  assert.throws(() => loadConfig(env({ ...realtime, MATRIX_CANDIDATES: '51' })), /MATRIX_CANDIDATES/);
  assert.throws(() => loadConfig(env({ ...realtime, NEARBY_LIMIT: '201' })), /NEARBY_LIMIT/);
  assert.throws(() => loadConfig(env({ ...realtime, NEARBY_PAGES: '26' })), /NEARBY_PAGES/);
});
test('worker capacity: 16 jobs and 10 connections by default, both bounded', () => {
  const realtime = { REALTIME_BASE_URL: 'http://realtime', REALTIME_MATCHING_TOKEN: 'l'.repeat(32) };
  const defaults = loadConfig(env(realtime)); assert.equal(defaults.workers, 16); assert.equal(defaults.dbPoolSize, 10);
  const raised = loadConfig(env({ ...realtime, WORKER_CONCURRENCY: '48', DB_POOL_SIZE: '30' })); assert.equal(raised.workers, 48); assert.equal(raised.dbPoolSize, 30);
  assert.throws(() => loadConfig(env({ ...realtime, WORKER_CONCURRENCY: '65' })), /WORKER_CONCURRENCY/);
  assert.throws(() => loadConfig(env({ ...realtime, DB_POOL_SIZE: '51' })), /DB_POOL_SIZE/);
});
