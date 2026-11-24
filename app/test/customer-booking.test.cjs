const {test} = require('node:test'), assert = require('node:assert/strict');
const {loader, deferred, flush, ids} = require('./helpers/driver.cjs');
const pickup = {lat: 21.0285, lng: 105.8542}, destination = {lat: 21.0272, lng: 105.8355};
const trip = (patch = {}) => ({tripId: ids.trip, driverId: null, vehicleId: null, status: 'SEARCHING', version: 1, pickup, destination, vehicleType: 'CAR_4', fare: {currency: 'VND', estimatedAmount: '9007199254740993', finalAmount: null}, ...patch});
const quote = (expiresAt = new Date(Date.now() + 300000).toISOString()) => ({quoteId: ids.offer, expiresAt, fare: {currency: 'VND', amount: '9007199254740993'}, route: {distanceMeters: 2546, durationSeconds: 600}});
function fixture(options = {}) {
  const load = loader(), {CustomerBookingStore} = load('src/features/customer/booking-store.ts');
  const {DurableCommand} = load('src/features/backend/durable-command.ts');
  const {BackendError} = load('src/features/backend/http.ts');
  let epoch = 1, saved = options.pending ?? null;
  const calls = [], storage = options.storage ?? {read: async () => saved, write: async value => {saved = value;}};
  const runtime = {
    session: {getOwnerEpoch: () => epoch, authorized: async work => work('customer-token')},
    trips: {active: async () => ({data: null}), estimate: async () => ({data: quote(), serverDate: Date.now()}), history: async () => ({data: {items: [], nextCursor: null}}),
      create: async (...args) => {calls.push(args); return {data: trip()};}, cancel: async (...args) => {calls.push(args); return {data: trip({status: 'CANCELLED', version: 2})};}, ...options.trips},
    routes: {route: async () => ({data: {polyline: {encoding: 'encoded_polyline', precision: 6, value: '???_ibE'}}})},
  };
  const commands = new DurableCommand(storage), store = new CustomerBookingStore(runtime, commands), stop = store.start();
  return {load, runtime, store, commands, calls, stop, BackendError, changeOwner: () => epoch++, saved: () => saved};
}
async function draft(f) {await flush(); assert.equal(f.store.draftLocked, false); f.store.setPoint('pickup', pickup); f.store.setPoint('destination', destination);}

test('Customer recovery gates draft/new commands until both active Trip and journal are read', async t => {
  const active = deferred(), journal = deferred();
  const f = fixture({trips: {active: () => active.promise}, storage: {read: () => journal.promise, write: async () => {}}}); t.after(f.stop);
  assert.equal(f.store.setPoint('pickup', pickup), false); await f.store.create(); assert.equal(f.calls.length, 0);
  active.resolve({data: null}); await flush(); assert.equal(f.store.draftLocked, true);
  journal.resolve(null); await flush(); assert.equal(f.store.draftLocked, false);
  assert.deepEqual(f.store.getSnapshot().draft, {pickup: null, destination: null, vehicleType: 'CAR_4'});
});

test('Customer stale quote/preview cannot restore old inputs; money string and server expiry stay exact', async t => {
  const result = deferred(), f = fixture({trips: {estimate: () => result.promise}}); t.after(f.stop); await draft(f);
  const estimating = f.store.estimate(); f.store.setVehicle('CAR_7'); result.resolve({data: quote(), serverDate: Date.now()}); await estimating;
  assert.equal(f.store.getSnapshot().quote, null); assert.equal(f.store.getSnapshot().step, 'draft');
  const preview = deferred(); f.runtime.routes.route = () => preview.promise;
  const serverDate = Date.now() + 3600000;
  f.runtime.trips.estimate = async () => ({data: quote(new Date(serverDate - 1000).toISOString()), serverDate});
  const next = f.store.estimate(); await flush(); assert.equal(f.store.getSnapshot().quote.amount, '9007199254740993');
  await f.store.create(); assert.equal(f.calls.length, 0); assert.equal(f.store.getSnapshot().quote, null);
  preview.resolve({data: {polyline: {encoding: 'encoded_polyline', precision: 6, value: '???_ibE'}}}); await next;
  assert.equal(f.store.getSnapshot().line, undefined);
});

test('Customer timeout locks new create, restart retains key/body and retry reconciles current version', async t => {
  const f = fixture(); t.after(f.stop); await draft(f); await f.store.estimate();
  f.runtime.trips.create = async (...args) => {f.calls.push(args); throw new f.BackendError('TIMEOUT');};
  await Promise.all([f.store.create(), f.store.create()]); assert.equal(f.calls.length, 1);
  const intent = structuredClone(f.saved()); assert.ok(intent); assert.equal(f.store.draftLocked, true);
  const g = fixture({pending: intent, trips: {active: async () => ({data: trip({version: 7})})}}); t.after(g.stop); await flush();
  assert.equal(g.calls.length, 0); assert.equal(g.store.getSnapshot().current.version, 7);
  await g.store.retryCommand(); assert.equal(g.calls[0][2], intent.key); assert.equal(g.calls[0][1], intent.body.quoteId);
  assert.equal(g.store.getSnapshot().current.version, 7); assert.equal(g.saved(), null);
});

test('Customer active Trip survives history loads; cancellation uses server version and blocks double tap', async t => {
  let active = trip({version: 9}); const response = deferred();
  const f = fixture({trips: {active: async () => ({data: active})}}); t.after(f.stop); await flush();
  await f.store.loadHistory(); assert.equal(f.store.getSnapshot().current.version, 9); assert.equal(f.store.draftLocked, true);
  f.runtime.trips.cancel = async (...args) => {f.calls.push(args); return response.promise;};
  const a = f.store.cancel(), b = f.store.cancel(); await flush(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0][2], 9);
  active = null; response.resolve({data: trip({status: 'CANCELLED', version: 10})}); await Promise.all([a, b]);
  assert.equal(f.store.getSnapshot().current.status, 'CANCELLED'); assert.equal(f.store.canStartNewBooking, true);
  f.store.newBooking(); await flush(); assert.equal(f.store.draftLocked, false);
});

test('Customer account change discards delayed history/quote and prevents old intent using a new session', async t => {
  const history = deferred(), estimate = deferred(), write = deferred();
  const f = fixture({storage: {read: async () => null, write: () => write.promise}, trips: {history: () => history.promise, estimate: () => estimate.promise}}); t.after(f.stop); await draft(f);
  const h = f.store.loadHistory(), q = f.store.estimate(); f.changeOwner();
  history.resolve({data: {items: [trip()], nextCursor: null}}); estimate.resolve({data: quote(), serverDate: Date.now()}); await Promise.all([h, q]);
  assert.equal(f.store.getSnapshot().quote, null); assert.equal(f.store.getSnapshot().history.items.length, 0);
  const g = fixture({storage: {read: async () => null, write: () => write.promise}}); t.after(g.stop); await draft(g); await g.store.estimate();
  const create = g.store.create(); await flush(); g.changeOwner(); write.resolve(); await create; assert.equal(g.calls.length, 0);
});

test('Customer journal read failure and active failure show retry, keep create locked and never render technical errors', async t => {
  let failed = true;
  const f = fixture({storage: {read: async () => {if (failed) throw Error('private stack'); return null;}, write: async () => {}}, trips: {active: async () => {if (failed) throw Error('internal URL'); return {data: null};}}}); t.after(f.stop); await flush();
  assert.equal(f.store.draftLocked, true); assert.equal(f.store.getSnapshot().commandsLoading, false); assert.doesNotMatch(f.store.getSnapshot().error, /private|stack/); assert.doesNotMatch(f.store.getSnapshot().activeError, /internal|URL/);
  failed = false; await f.store.retryRecovery(); assert.equal(f.store.draftLocked, false);
});

test('Customer malformed command receipt stays pending and old active GET cannot undo create', async t => {
  const f = fixture(); t.after(f.stop); await draft(f); await f.store.estimate();
  f.runtime.trips.create = async () => ({data: {invalid: true}});
  await f.store.create(); assert.ok(f.saved()); assert.equal(f.store.draftLocked, true);
  f.runtime.trips.create = async () => ({data: trip({version: 3})});
  const old = deferred(); f.runtime.trips.active = () => old.promise; const stale = f.store.refresh();
  f.runtime.trips.active = async () => ({data: trip({version: 4})});
  await f.store.retryCommand(); old.resolve({data: null}); await stale;
  assert.equal(f.store.getSnapshot().current.version, 4); assert.equal(f.store.draftLocked, true);
});
