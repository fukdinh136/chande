const { test } = require('node:test'), assert = require('node:assert/strict');
const { loader, deferred, flush, owner, ids } = require('./helpers/driver.cjs');
const startTime = Date.UTC(2026, 9, 12);
function locationStore() {
  let point = null; const listeners = new Set();
  return { currentLocation: () => point, setLocation: value => { point = value; for (const fn of listeners) fn(); }, subscribeLocation: fn => { listeners.add(fn); return () => listeners.delete(fn); }, listeners };
}
const sample = (time = Date.now(), accuracy = 5) => ({ lat: 21, lng: 105, accuracy, timestamp: time, speed: 0, heading: 0 });
const deviceSample = (time = Date.now(), accuracy = 5) => ({ timestamp: time, coords: { latitude: 21, longitude: 105, accuracy, speed: 0, heading: 0 } });
async function gpsFixture(t, permission = { granted: true, canAskAgain: true }) {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: startTime });
  const session = owner(), map = locationStore(), clients = [], fix = deferred(); let callback, removed = 0, watches = 0;
  const location = { Accuracy: { High: 4 }, getForegroundPermissionsAsync: async () => permission, requestForegroundPermissionsAsync: async () => permission, hasServicesEnabledAsync: async () => true,
    watchPositionAsync: async (_, fn) => { watches++; callback = fn; return { remove: () => { removed++; } }; }, getCurrentPositionAsync: () => fix.promise };
  class SocketLocationClient {
    constructor(_, notify) { this.notify = notify; this.sent = []; this.pending = []; clients.push(this); }
    start() { this.notify('connected'); }
    stop() { this.stopped = true; }
    send(payload) { const d = deferred(); this.sent.push(payload); this.pending.push(d); return d.promise; }
  }
  const load = loader({ 'expo-location': location, 'src/features/map/location-store.ts': map, 'src/features/driver/gps/socket-location-client.ts': { SocketLocationClient } });
  const { DriverGpsSession } = load('src/features/driver/gps/gps-session.ts'), gps = new DriverGpsSession(session, 'http://realtime.test', {});
  t.after(() => gps.dispose()); gps.configure(true, true, true); await flush();
  return { gps, session, map, clients, fix, location, emit: value => callback(value), get removed() { return removed; }, get watches() { return watches; } };
}
test('Driver GPS filters accuracy/time, uses 10 second publisher and never resends old sample', async t => {
  const f = await gpsFixture(t), client = f.clients[0]; f.emit(deviceSample(Date.now(), 101)); t.mock.timers.tick(1000); await flush(); assert.equal(client.sent.length, 0); assert.equal(f.gps.getSnapshot().issue, 'LOW_ACCURACY');
  f.emit(deviceSample()); t.mock.timers.tick(1000); await flush(); assert.equal(client.sent.length, 1);
  client.pending[0].resolve({ recordedAt: client.sent[0].recordedAt, receivedAt: new Date().toISOString(), disposition: 'STORED' }); await flush(); assert.equal(f.gps.getSnapshot().acceptedFresh, true);
  t.mock.timers.tick(8000); await flush(); assert.equal(client.sent.length, 1);
  f.emit(deviceSample()); t.mock.timers.tick(1000); await flush(); assert.equal(client.sent.length, 1);
  t.mock.timers.tick(1000); await flush(); assert.equal(client.sent.length, 2);
});
test('Driver GPS late ACK ages from measurement, pause and old owner cannot restore updating state', async t => {
  const f = await gpsFixture(t), client = f.clients[0]; f.emit(deviceSample()); t.mock.timers.tick(1000); await flush();
  t.mock.timers.tick(30000); await flush(); client.pending[0].resolve({ recordedAt: client.sent[0].recordedAt, receivedAt: new Date().toISOString(), disposition: 'STORED' }); await flush();
  assert.equal(f.gps.getSnapshot().acceptedFresh, false); assert.equal(f.gps.getSnapshot().issue, 'LOCATION_STALE'); assert.equal(f.map.currentLocation(), null);
  f.gps.configure(true, false, true); assert.equal(f.gps.getSnapshot().watcher, 'paused'); assert.equal(f.gps.getSnapshot().sending, false); assert.equal(f.removed, 1);
  f.gps.configure(true, true, true); await flush(); assert.equal(f.watches, 2); f.emit(deviceSample()); t.mock.timers.tick(1000); await flush();
  const current = f.clients[1]; f.session.change(ids.other); current.pending[0]?.resolve({ recordedAt: current.sent[0].recordedAt, receivedAt: new Date().toISOString(), disposition: 'STORED' }); await flush();
  assert.equal(f.gps.getSnapshot().sample, null); assert.equal(f.gps.getSnapshot().accepted, null); assert.equal(f.gps.getSnapshot().requested, false);
});
test('Driver GPS denied/system disabled creates no watcher or socket; foreground rechecks permission', async t => {
  const f = await gpsFixture(t, { granted: false, canAskAgain: false }); assert.equal(f.watches, 0); assert.equal(f.clients.length, 0); assert.equal(f.gps.getSnapshot().permission, 'blocked');
  f.location.getForegroundPermissionsAsync = async () => ({ granted: true, canAskAgain: true }); f.location.hasServicesEnabledAsync = async () => false;
  f.gps.configure(true, true, true); await flush(); assert.equal(f.watches, 0); assert.equal(f.gps.getSnapshot().services, 'disabled');
  f.location.hasServicesEnabledAsync = async () => true; f.gps.configure(true, true, false); await flush(); assert.equal(f.watches, 1); assert.equal(f.clients.length, 0);
});
function richRoute() {
  const geometry = '_oyo@_gncG_ibE_ibE'; // Two real polyline6 points, not a native navigation substitute.
  const maneuver = type => ({ type, location: [105, 21], bearing_before: 0, bearing_after: 90 });
  return { data: { schemaVersion: 1, geometryPrecision: 6, provider: 'OSRM', vehicleType: 'BIKE', calculatedAt: new Date().toISOString(), route: { geometry, distance: 500, duration: 120, legs: [{ distance: 500, duration: 120, summary: '', steps: [{ name: '', geometry, distance: 500, duration: 120, maneuver: maneuver('depart') }, { name: '', geometry, distance: 0, duration: 0, maneuver: maneuver('arrive') }] }] } } };
}
function navigationFixture(t, native = null) {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: startTime });
  const session = owner(), map = locationStore(), calls = [];
  const load = loader({ 'src/features/map/location-store.ts': map, 'src/features/navigation/native.ts': { Navigation: native } });
  const runtime = { session, capabilities: { routing: { configured: true } }, navigation: { navigation: async (...args) => { const d = deferred(); calls.push({ ...d, args }); return d.promise; } } };
  const { DriverNavigationSession } = load('src/features/driver/navigation/navigation-session.ts'), navigation = new DriverNavigationSession(runtime);
  t.after(() => navigation.stop()); map.setLocation(sample());
  const trip = { tripId: ids.trip, status: 'ASSIGNED', vehicleType: 'BIKE', pickup: { lat: 21.01, lng: 105.01 }, destination: { lat: 21.1, lng: 105.1 } };
  return { session, map, runtime, navigation, calls, trip };
}
test('Driver without native SDK keeps valid Routing preview and does not poll Routing by timer', async t => {
  const f = navigationFixture(t); f.navigation.start(f.trip); f.calls[0].resolve(richRoute()); await flush();
  assert.equal(f.navigation.nativeSupported, false); assert.equal(f.navigation.getSnapshot().stage, 'preview'); assert.equal(f.navigation.getSnapshot().line.length, 2);
  t.mock.timers.tick(10000); await flush(); assert.equal(f.calls.length, 1);
  f.navigation.stop(); assert.equal(f.map.listeners.size, 0); assert.equal(f.navigation.getSnapshot().line, undefined);
});
test('Driver phase switch discards late route and clears preview on failure/stale GPS', async t => {
  const f = navigationFixture(t); f.navigation.start(f.trip); f.navigation.start({ ...f.trip, status: 'IN_PROGRESS' });
  t.mock.timers.tick(5000); await flush(); assert.equal(f.calls.length, 2); assert.equal(f.calls[0].args[3].aborted, true);
  f.calls[0].resolve(richRoute()); await flush(); assert.equal(f.navigation.getSnapshot().line, undefined); f.calls[1].reject(Error('routing down')); await flush(); assert.equal(f.navigation.getSnapshot().stage, 'error');
  t.mock.timers.tick(5000); f.navigation.retry(); f.calls[2].resolve(richRoute()); await flush(); assert.equal(f.navigation.getSnapshot().stage, 'preview');
  t.mock.timers.tick(30000); await flush(); assert.equal(f.navigation.getSnapshot().stage, 'waiting-gps'); assert.equal(f.navigation.getSnapshot().line, undefined); assert.equal(f.navigation.getSnapshot().progress, null);
});
test('Driver native session ID excludes old phase progress; cleanup removes native listeners', async t => {
  const handlers = [], starts = [], native = { addListener: (event, fn) => { const h = { event, fn, removed: false }; handlers.push(h); return { remove: () => { h.removed = true; } }; }, pushLocation: () => {}, start: (_, id) => { starts.push(id); return true; }, stop: () => {} };
  const f = navigationFixture(t, native); f.navigation.start(f.trip); f.calls[0].resolve(richRoute()); await flush(); assert.equal(f.navigation.getSnapshot().stage, 'navigating');
  const oldProgress = handlers.find(h => h.event === 'progress').fn; f.navigation.start({ ...f.trip, status: 'IN_PROGRESS' }); t.mock.timers.tick(5000); await flush(); f.calls[1].resolve(richRoute()); await flush();
  oldProgress({ sessionId: starts[0], remainingDistanceMeters: 50, remainingDurationSeconds: 5, distanceToManeuverMeters: 20 }); assert.equal(f.navigation.getSnapshot().progress, null);
  f.session.change(ids.other); assert.equal(f.navigation.getSnapshot().stage, 'paused'); assert.ok(handlers.every(h => h.removed));
});
