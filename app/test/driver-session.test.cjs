const { test } = require('node:test'), assert = require('node:assert/strict');
const { loader, deferred, flush, ids, tokens, memoryStorage } = require('./helpers/driver.cjs');
function fixture(t, options = {}) {
  const load = loader(), { SessionManager } = load('src/features/driver/session/session-manager.ts'), { ApiError } = load('src/features/driver/http/errors.ts');
  const storage = memoryStorage(), calls = { refresh: 0, logout: [], http: [] };
  const auth = { verifyOtp: async () => tokens({ expiresIn: options.expiresIn ?? 900 }), refresh: async () => { calls.refresh++; return tokens({ accessToken: 'next-access', refreshToken: 'next-refresh' }); }, logout: async token => { calls.logout.push(token); } };
  const http = { send: async (spec, token) => { calls.http.push({ spec, token }); return { data: {}, meta: {} }; } };
  const session = new SessionManager(auth, http, storage); t.after(() => session.dispose());
  return { session, auth, http, storage, calls, ApiError };
}
test('Driver restore timeout retains a durable uncertain credential; restart never retries it', async t => {
  const f = fixture(t); await f.storage.write({ token: 'prior', driverId: ids.driver, refreshState: 'ready' });
  f.auth.refresh = async () => { f.calls.refresh++; throw new f.ApiError('TIMEOUT'); };
  await f.session.restore();
  assert.equal(f.session.getSnapshot().phase, 'refresh-uncertain'); assert.equal(f.session.getSnapshot().usable, false);
  assert.equal((await f.storage.read()).token, 'prior'); assert.equal((await f.storage.read()).refreshState, 'uncertain');
  await f.session.recover(); await assert.rejects(f.session.accessToken(), e => e.code === 'REFRESH_UNCERTAIN');
  f.session.dispose(); await f.session.restore(); assert.equal(f.calls.refresh, 1);
});
test('Driver credential read failure is recoverable without deleting stored refresh', async t => {
  const f = fixture(t), original = f.storage.read; let unavailable = true;
  await f.storage.write({ token: 'prior', driverId: ids.driver, refreshState: 'ready' });
  f.storage.read = async () => { if (unavailable) throw Error('secure storage unavailable'); return original(); };
  await f.session.restore(); assert.equal(f.session.getSnapshot().phase, 'unavailable');
  unavailable = false; await f.session.recover(); assert.equal(f.session.getSnapshot().usable, true); assert.equal(f.calls.refresh, 1);
});
test('Driver concurrent requests share refresh and wait for new credential persistence', async t => {
  const f = fixture(t, { expiresIn: 1 }); await f.session.login('phone', 'challenge', '123456');
  const response = deferred(), save = deferred(), original = f.storage.write;
  f.auth.refresh = async () => { f.calls.refresh++; return response.promise; };
  f.storage.write = async value => { if (value?.token === 'next-refresh') await save.promise; return original(value); };
  const a = f.session.request({ service: 'driver', method: 'GET', path: '/a' }), b = f.session.request({ service: 'driver', method: 'GET', path: '/b' });
  await flush(); assert.equal(f.calls.refresh, 1); response.resolve(tokens({ accessToken: 'next-access', refreshToken: 'next-refresh' }));
  await flush(); assert.equal(f.calls.http.length, 0); save.resolve(); await Promise.all([a, b]);
  assert.equal(f.calls.http.length, 2); assert.ok(f.calls.http.every(c => c.token === 'next-access')); assert.equal((await f.storage.read()).token, 'next-refresh');
});
test('Driver synchronous refresh observer cannot initiate a second rotation', async t => {
  const f = fixture(t, { expiresIn: 1 }); await f.session.login('p', 'c', '123456');
  let observed = false, follower;
  const unsubscribe = f.session.subscribe(() => { if (f.session.getSnapshot().phase === 'refreshing' && !observed) { observed = true; follower = f.session.accessToken(); } });
  await f.session.accessToken(); await follower; unsubscribe(); assert.equal(f.calls.refresh, 1);
});
test('Driver SecureStore installation failure retries storage only, never old rotated token', async t => {
  const f = fixture(t, { expiresIn: 1 }); await f.session.login('p', 'c', '123456');
  const original = f.storage.write; let fail = true;
  f.storage.write = async value => { if (fail && value?.token === 'next-refresh') throw Error('disk'); return original(value); };
  await assert.rejects(f.session.accessToken(), e => e.code === 'REFRESH_UNCERTAIN');
  assert.equal(f.session.getSnapshot().phase, 'credential-error'); assert.equal(f.session.getSnapshot().usable, false);
  fail = false; await f.session.recover(); assert.equal(await f.session.accessToken(), 'next-access'); assert.equal(f.calls.refresh, 1);
});
test('Driver refresh denial alone clears credentials, downstream 401/403 do not', async t => {
  const f = fixture(t); await f.session.login('p', 'c', '123456');
  f.http.send = async () => { throw new f.ApiError('UNAUTHENTICATED', 401); };
  await assert.rejects(f.session.request({ service: 'trip', method: 'GET', path: '/trips' }));
  assert.equal(f.calls.refresh, 0); assert.equal(f.session.getSnapshot().usable, true); assert.ok(await f.storage.read());
  f.auth.refresh = async () => { f.calls.refresh++; throw new f.ApiError('INVALID_REFRESH_TOKEN', 401); };
  await assert.rejects(f.session.request({ service: 'driver', method: 'GET', path: '/drivers/me' }));
  assert.equal(f.session.getSnapshot().phase, 'reauth-required'); assert.equal(await f.storage.read(), null);
});
test('Driver 401 retries an idempotent command with exact key/body; non-idempotent POST is not resent', async t => {
  const f = fixture(t); await f.session.login('p', 'c', '123456'); const calls = [];
  f.http.send = async (spec, token) => { calls.push({ spec, token }); if (token === 'test-access') throw new f.ApiError('UNAUTHENTICATED', 401); return { data: {} }; };
  const command = { service: 'driver', method: 'PUT', path: '/drivers/me/availability', body: { desiredStatus: 'ONLINE', version: 7 }, key: 'fixed-command-key' };
  await f.session.request(command); assert.equal(calls.length, 2); assert.equal(calls[0].spec.body, calls[1].spec.body); assert.equal(calls[1].spec.key, command.key);
  await f.session.login('p', 'c', '123456'); calls.length = 0;
  await assert.rejects(f.session.request({ service: 'driver', method: 'POST', path: '/drivers/me/vehicles', body: {} })); assert.equal(calls.length, 1);
});
test('Driver logout/account switch during refresh suppresses old installation and revokes received token', async t => {
  const f = fixture(t, { expiresIn: 1 }); await f.session.login('p', 'c', '123456'); const response = deferred();
  f.auth.refresh = async () => response.promise;
  const pending = f.session.accessToken(); const rejected = assert.rejects(pending, e => e.code === 'CANCELLED'); await flush();
  await f.session.logout(); f.auth.verifyOtp = async () => tokens({ driver: { driverId: ids.other }, accessToken: 'other-access', refreshToken: 'other-refresh' });
  await f.session.login('other', 'c', '123456'); response.resolve(tokens({ refreshToken: 'late-refresh' })); await rejected; await flush();
  assert.equal((await f.storage.read()).token, 'other-refresh'); assert.equal(f.session.getSnapshot().session.driver.driverId, ids.other); assert.ok(f.calls.logout.includes('late-refresh'));
});
test('Driver expired uncertain access blocks HTTP and retains pending command storage', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 9, 12) });
  const f = fixture(t, { expiresIn: 1 }); await f.session.login('p', 'c', '123456');
  f.storage.records.set('pending-command', 'fixed-key'); f.auth.refresh = async () => { throw new f.ApiError('NETWORK_ERROR'); };
  assert.equal(await f.session.accessToken(), 'test-access'); t.mock.timers.tick(1001);
  await assert.rejects(f.session.request({ service: 'driver', method: 'GET', path: '/drivers/me' }), e => e.code === 'REFRESH_UNCERTAIN');
  assert.equal(f.calls.http.length, 0); assert.ok(await f.storage.read()); assert.equal(f.storage.records.get('pending-command'), 'fixed-key');
});
