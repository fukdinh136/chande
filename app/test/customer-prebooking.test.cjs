const {test} = require('node:test'), assert = require('node:assert/strict');
const {loader, deferred, flush, ids} = require('./helpers/driver.cjs');
const pickup = {lat: 21.0285, lng: 105.8542}, destination = {lat: 21.0272, lng: 105.8355};
function setup(overrides = {}) {
  const load = loader(), {CustomerBookingStore} = load('src/features/customer/booking-store.ts'), {DurableCommand} = load('src/features/backend/durable-command.ts');
  let epoch = 1;
  const quote = () => ({quoteId: ids.offer, createdAt: new Date(Date.now() - 3600000).toISOString(), expiresAt: new Date(Date.now() - 3600000 + 300000).toISOString(), fare: {currency: 'VND', amount: '9007199254740993'}, route: {distanceMeters: 2546, durationSeconds: 600}});
  const calls = [];
  const runtime = {session: {getOwnerEpoch: () => epoch, authorized: async work => work('test-token')},
    trips: {active: async () => ({data: null, serverDate: null}), estimate: async (...args) => {calls.push(args); return {data: quote(), serverDate: null};}, create: async () => {throw Error('Unexpected create');}, ...overrides},
    routes: {route: async () => ({data: {polyline: {encoding: 'encoded_polyline', precision: 6, value: '???_ibE'}}})},
  };
  const store = new CustomerBookingStore(runtime, new DurableCommand({read: async () => null, write: async () => {}})), stop = store.start();
  return {load, store, runtime, stop, calls, quote, changeOwner: () => epoch++};
}
async function confirmed(f) {await flush(); f.store.setPoint('pickup', pickup); f.store.setPoint('destination', destination);}

test('Customer map starts without confirmed points; each temporary pin/saved place needs confirmation', async t => {
  const f = setup(); t.after(f.stop); await flush();
  assert.equal(f.store.pointsReady, false); assert.equal(f.store.getSnapshot().draft.pickup, null); assert.equal(f.store.getSnapshot().candidate, null);
  f.store.proposePoint(pickup); assert.equal(f.store.getSnapshot().draft.pickup, null);
  assert.equal(f.store.getSnapshot().candidate.label, 'Vị trí đã chọn'); await f.store.estimate(); assert.equal(f.calls.length, 0);
  f.store.confirmPoint(); assert.deepEqual(f.store.getSnapshot().draft.pickup, pickup); assert.equal(f.store.getSnapshot().selecting, 'destination'); assert.equal(f.store.pointsReady, false);
  f.store.proposePoint({...destination, address: 'Địa chỉ đã lưu'}, 'Nhà'); f.store.confirmPoint();
  assert.equal(f.store.pointsReady, true); assert.equal(f.store.getSnapshot().pointLabels.destination, 'Nhà');
  f.store.goTo('vehicle'); assert.equal(f.store.getSnapshot().flow, 'vehicle'); await f.store.estimate();
  assert.equal(f.calls.length, 1); assert.equal(f.store.getSnapshot().quote.amount, '9007199254740993');
  assert.deepEqual(f.calls[0][2], {...destination, address: 'Địa chỉ đã lưu'}); assert.equal(Object.hasOwn(f.calls[0][2], 'label'), false);
});

test('Customer invalid coordinate/address cannot proceed; cancel editing retains confirmed values but not an old quote', async t => {
  const f = setup(); t.after(f.stop); await confirmed(f); await f.store.estimate(); assert.equal(f.store.quoteUsable, true);
  f.store.selectKind('pickup'); assert.equal(f.store.getSnapshot().quote, null); assert.equal(f.store.quoteUsable, false);
  for (const value of [{lat: NaN, lng: 105}, {lat: 86, lng: 105}, {lat: 21, lng: 181}, {...pickup, address: 'x'.repeat(501)}, {...pickup, address: ' '}]) {
    assert.equal(f.store.proposePoint(value), false); assert.equal(f.store.pointsReady, false);
  }
  f.store.cancelEditing(); assert.deepEqual(f.store.getSnapshot().draft.pickup, pickup); assert.equal(f.store.pointsReady, true); assert.equal(f.store.getSnapshot().quote, null);
});

test('Customer changing a point while quote loads discards both old fare and route; vehicle change invalidates immediately', async t => {
  const wait = deferred(), f = setup({estimate: () => wait.promise}); t.after(f.stop); await confirmed(f);
  const old = f.store.estimate(); f.store.selectKind('destination'); f.store.proposePoint({lat: 21.04, lng: 105.88});
  wait.resolve({data: f.quote(), serverDate: null}); await old;
  assert.equal(f.store.getSnapshot().quote, null); assert.equal(f.store.getSnapshot().line, undefined); assert.equal(f.store.pointsReady, false);
  f.store.confirmPoint(); f.runtime.trips.estimate = async () => ({data: f.quote(), serverDate: null}); await f.store.estimate();
  f.store.setVehicle('CAR_7'); assert.equal(f.store.getSnapshot().quote, null); assert.equal(f.store.getSnapshot().line, undefined); assert.equal(f.store.getSnapshot().flow, 'vehicle');
});

test('Customer quote uses server createdAt when Date is hidden, and expires across background before any new command', async t => {
  let wall = Date.now(); t.mock.method(Date, 'now', () => wall);
  const f = setup(); t.after(f.stop); await confirmed(f); await f.store.estimate();
  assert.ok(f.store.remainingQuoteMs() > 295000); assert.ok(f.store.remainingQuoteMs() <= 300000); assert.equal(f.store.quoteUsable, true);
  f.store.setForeground(false); wall += 301000; f.store.setForeground(true); assert.equal(f.store.quoteUsable, false); assert.equal(f.store.getSnapshot().quoteExpired, true);
  await f.store.create(); assert.equal(f.store.getSnapshot().busy, false); assert.equal(f.store.commands.getSnapshot().pending, null);
});

test('Customer foreground rechecks server time and requires a new quote when that time cannot be verified', async t => {
  const f = setup(); t.after(f.stop); await confirmed(f); await f.store.estimate();
  f.store.goTo('confirm'); f.store.setForeground(false); f.store.setForeground(true); assert.equal(f.store.quoteUsable, false);
  const server = Date.parse(f.store.getSnapshot().quote.createdAt);
  f.runtime.trips.active = async () => ({data: null, serverDate: server + 10000}); await f.store.refresh(); assert.equal(f.store.quoteUsable, true);
  f.store.setForeground(false); f.store.setForeground(true); f.runtime.trips.active = async () => ({data: null, serverDate: null}); await f.store.refresh();
  assert.equal(f.store.quoteUsable, false); assert.equal(f.store.getSnapshot().quoteExpired, true); assert.match(f.store.getSnapshot().quoteProblem, /lấy giá mới/);
});

test('Customer missing server time fails closed and wall-clock rollback cannot extend the quote', async t => {
  const f = setup(); t.after(f.stop); await confirmed(f);
  f.runtime.trips.estimate = async () => {const raw = f.quote(); delete raw.createdAt; return {data: raw, serverDate: null};};
  await f.store.estimate(); assert.equal(f.store.getSnapshot().quote, null); assert.match(f.store.getSnapshot().error, /thời gian máy chủ/);
  const {quoteRemaining} = f.load('src/features/customer/booking-policy.ts');
  const clock = {wall: 50000, steady: 1000, server: 80000, expires: 100000};
  assert.equal(quoteRemaining(clock, 1, 22000), 0); assert.equal(quoteRemaining(clock, 50000, 6000), 15000);
});

test('Customer GPS candidate never replaces a confirmed point; manual edit, tab leave and owner change discard late GPS', async t => {
  const f = setup(); t.after(f.stop); await confirmed(f);
  const first = deferred(); let calls = 0;
  const locate = () => {calls++; return first.promise;};
  const request = f.store.requestLocation(locate); void f.store.requestLocation(locate); assert.equal(calls, 1);
  first.resolve({lat: 20, lng: 104}); await request; assert.deepEqual(f.store.getSnapshot().draft.pickup, pickup); assert.equal(f.store.getSnapshot().candidate.label, 'Vị trí hiện tại');
  const second = deferred(), job = f.store.requestLocation(() => second.promise);
  f.store.proposePoint({lat: 21.1, lng: 105.2}); second.resolve({lat: 20, lng: 104}); await job; assert.deepEqual(f.store.getSnapshot().candidate.point, {lat: 21.1, lng: 105.2});
  const third = deferred(), leaving = f.store.requestLocation(() => third.promise); f.store.cancelLocation(); third.resolve(pickup); await leaving; assert.equal(f.store.getSnapshot().candidate, null);
  const fourth = deferred(), switching = f.store.requestLocation(() => fourth.promise); f.changeOwner(); fourth.resolve(pickup); await switching; assert.equal(f.store.getSnapshot().candidate, null);
});

test('Customer one-shot GPS handles permission, services, errors, cancellation and timeout without subscribing', async () => {
  for (const kind of ['DENIED', 'DISABLED', 'UNAVAILABLE', 'SUCCESS']) {
    let permissions = 0, fixes = 0;
    const load = loader({'expo-location': {Accuracy: {Balanced: 3}, requestForegroundPermissionsAsync: async () => {permissions++; return {granted: kind !== 'DENIED'};}, hasServicesEnabledAsync: async () => kind !== 'DISABLED',
      getCurrentPositionAsync: async () => {fixes++; if (kind === 'UNAVAILABLE') throw Error('native stack'); return {timestamp: Date.now(), coords: {latitude: 21, longitude: 105}};},
      watchPositionAsync: () => {throw Error('Watcher must never run');},
    }});
    const {currentLocation, locationMessage} = load('src/features/customer/current-location.ts'); assert.equal(permissions, 0); assert.equal(fixes, 0);
    const job = currentLocation(new AbortController().signal);
    if (kind === 'SUCCESS') assert.deepEqual(await job, {lat: 21, lng: 105});
    else {let error; try {await job;} catch (value) {error = value;} assert.ok(error); assert.doesNotMatch(locationMessage(error), /native stack|UNAVAILABLE|DISABLED|DENIED/);}
    assert.equal(permissions, 1); assert.equal(fixes, ['UNAVAILABLE', 'SUCCESS'].includes(kind) ? 1 : 0);
  }
  const waiting = deferred(); let fixes = 0;
  const load = loader({'expo-location': {Accuracy: {}, requestForegroundPermissionsAsync: () => waiting.promise, getCurrentPositionAsync: () => {fixes++;}}});
  const {currentLocation} = load('src/features/customer/current-location.ts');
  const control = new AbortController(), cancelled = currentLocation(control.signal); control.abort(); await assert.rejects(cancelled, error => error.code === 'CANCELLED');
  await assert.rejects(currentLocation(new AbortController().signal, 5), error => error.code === 'TIMEOUT'); waiting.resolve({granted: true}); await flush(); assert.equal(fixes, 0);
});
