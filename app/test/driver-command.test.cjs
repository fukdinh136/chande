const { test } = require('node:test'), assert = require('node:assert/strict');
const { loader, deferred, flush, owner, ids } = require('./helpers/driver.cjs');
const trip = { tripId: ids.trip, driverId: ids.driver, status: 'ASSIGNED', version: 2 };
test('Driver Trip command survives timeout/429, restores without sending and retries exact command', async t => {
  const load = loader(), { TripCommandManager } = load('src/features/driver/state/trip-command-manager.ts'), { ApiError } = load('src/features/driver/http/errors.ts'), session = owner(); let stored = null;
  const storage = { readCommand: async () => stored, writeCommand: async (_, value) => { stored = value; } }, calls = [], api = { execute: async command => { calls.push(command); throw new ApiError('TIMEOUT'); } };
  const manager = new TripCommandManager(api, session, storage); t.after(() => manager.dispose()); await manager.initialize(ids.driver);
  await Promise.all([manager.advance(trip), manager.advance(trip)]); assert.equal(calls.length, 1); assert.ok(stored); const first = structuredClone(stored);
  manager.dispose(); const restored = new TripCommandManager(api, session, storage); t.after(() => restored.dispose()); await restored.initialize(ids.driver); assert.equal(calls.length, 1);
  api.execute = async command => { calls.push(command); throw new ApiError('RATE_LIMITED', 429); }; await restored.retry(); assert.deepEqual(calls[1], first); assert.deepEqual(stored, first);
  api.execute = async command => { calls.push(command); return { trip: {}, replayed: true }; }; await restored.retry(); assert.deepEqual(calls[2], first); assert.equal(stored, null); assert.match(restored.getSnapshot().message, /kết quả lệnh trước/);
});
test('Driver Trip late completion after logout cannot clear pending command or publish success', async t => {
  const load = loader(), { TripCommandManager } = load('src/features/driver/state/trip-command-manager.ts'), session = owner(), response = deferred(); let stored = null;
  const manager = new TripCommandManager({ execute: () => response.promise }, session, { readCommand: async () => stored, writeCommand: async (_, value) => { stored = value; } }); t.after(() => manager.dispose());
  await manager.initialize(ids.driver); const pending = manager.advance(trip); await flush(); session.change(null); response.resolve({ trip: {}, replayed: false }); await pending;
  assert.ok(stored); assert.equal(manager.getSnapshot().message, null); assert.equal(manager.getSnapshot().pending, null);
});
test('Driver command journal isolates environment/owner and legacy tombstone cannot resurrect', async () => {
  const native = new Map(), load = loader({ 'expo-secure-store': { getItemAsync: async key => native.get(key) ?? null, setItemAsync: async (key, value) => native.set(key, value), deleteItemAsync: async key => native.delete(key) } });
  const { DriverStorage } = load('src/features/driver/session/storage.ts'); const command = { driverId: ids.driver, tripId: ids.trip, key: ids.offer, createdAt: new Date().toISOString(), kind: 'status', body: { status: 'DRIVER_ARRIVED', version: 2 } };
  const a = new DriverStorage('auth-a', 'trip-a'), b = new DriverStorage('auth-b', 'trip-b'); await a.writeCommand(ids.driver, command); assert.deepEqual(await a.readCommand(ids.driver), command); assert.equal(await b.readCommand(ids.driver), null); assert.equal(await a.readCommand(ids.other), null);
  native.set('chande.driver.command.' + ids.driver, JSON.stringify({ scope: 'auth-a', command })); await a.writeCommand(ids.driver, null); assert.equal(await a.readCommand(ids.driver), null); assert.ok(native.has('chande.driver.command.' + ids.driver));
});
test('Driver credential deletion failure writes credential-free tombstone; command data is retained', async () => {
  const native = new Map(), load = loader({ 'expo-secure-store': { getItemAsync: async key => native.get(key) ?? null, setItemAsync: async (key, value) => native.set(key, value), deleteItemAsync: async () => { throw Error('OS deletion failed'); } } });
  const { DriverStorage } = load('src/features/driver/session/storage.ts'), storage = new DriverStorage('test');
  await storage.write({ token: 't'.repeat(40), driverId: ids.driver, refreshExpiresAt: null, refreshState: 'ready' }); await storage.writeOfferState('test', ids.driver, ids.offer, 'pending'); await storage.write(null);
  assert.equal(await storage.read(), null); assert.doesNotMatch(native.get('chande.driver.refresh'), /tttt/); assert.equal(await storage.readOfferState('test', ids.driver, ids.offer), 'pending');
});
