import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/bootstrap/config';

test('migration requires a PostgreSQL URL and accepts an isolated minimal configuration', () => {
  assert.equal(loadConfig({ DATABASE_URL: 'postgres://test:test@localhost/trip_test' }, 'migration').port, 3001);
  assert.throws(() => loadConfig({ DATABASE_URL: 'sqlite:local' }, 'migration'), /PostgreSQL/);
});
test('production refuses mock adapters', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', INTEGRATION_MODE: 'mock' }, 'migration'), /integration mode/);
});
test('conflicting secret sources and unsafe timing fail startup', () => {
  assert.throws(() => loadConfig({ DATABASE_URL: 'x', DATABASE_URL_FILE: 'x' }, 'migration'), /Ambiguous/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://localhost/test', HTTP_TIMEOUT_MS: '30000' }, 'migration'), /timing/);
});
test('numeric configuration is strict instead of silently coercing invalid input', () => {
  assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://localhost/test', PORT: '3001abc' }, 'migration'), /integer/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://localhost/test', PORT: '70000' }, 'migration'), /range/);
});
test('the notification destination is optional; when set, the worker needs its token', () => {
  const worker = { DATABASE_URL: 'postgres://test:test@localhost/trip_test', MATCHING_BASE_URL: 'http://matching', MATCHING_TOKEN: 'm', GATEWAY_EVENTS_BASE_URL: 'http://gateway', GATEWAY_EVENTS_TOKEN: 'g' };
  assert.equal(loadConfig(worker, 'worker').notificationUrl, '');
  assert.throws(() => loadConfig({ ...worker, NOTIFICATION_BASE_URL: 'http://notify' }, 'worker'), /NOTIFICATION_TOKEN/);
  assert.equal(loadConfig({ ...worker, NOTIFICATION_BASE_URL: 'http://notify', NOTIFICATION_TOKEN: 'n' }, 'worker').notificationUrl, 'http://notify');
});
