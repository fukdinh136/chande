const {test} = require('node:test'), assert = require('node:assert/strict');
const {loader, deferred, flush, ids} = require('./helpers/driver.cjs');
const pickup = {lat: 21.0285, lng: 105.8542}, destination = {lat: 21.0272, lng: 105.8355};
const wire = (patch = {}) => ({tripId: ids.trip, quoteId: ids.offer, driverId: null, vehicleId: null, status: 'SEARCHING', version: 1, pickup, destination, vehicleType: 'CAR_4', fare: {currency: 'VND', estimatedAmount: '9007199254740993', finalAmount: null}, ...patch});
function setup(options = {}) {
  const load = loader(), {CustomerBookingStore} = load('src/features/customer/booking-store.ts'), {DurableCommand} = load('src/features/backend/durable-command.ts'), {BackendError} = load('src/features/backend/http.ts');
  let epoch = 1, disk = options.pending ?? null;
  const server = options.server ?? {active: null, trips: new Map()};
  const calls = {create: [], cancel: [], active: 0, detail: 0};
  const storage = options.storage ?? {read: async () => disk, write: async command => {disk = command;}};
  const runtime = {session: {getOwnerEpoch: () => epoch, authorized: async work => work('owner-token')},
    trips: {active: async () => {calls.active++; return {data: server.active, serverDate: Date.now()};},
      detail: async (_, id) => {calls.detail++; const value = server.trips.get(id); if (!value) throw new BackendError('RESOURCE_NOT_FOUND', 404); return {data: {trip: value, statusHistory: []}};},
      estimate: async () => ({serverDate: Date.now(), data: {quoteId: ids.offer, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300000).toISOString(), fare: {currency: 'VND', amount: '9007199254740993'}, route: {distanceMeters: 2546, durationSeconds: 600}}}),
      create: async (...args) => {calls.create.push(args); const value = wire(); server.active = value; server.trips.set(value.tripId, value); return {data: value};},
      cancel: async (...args) => {calls.cancel.push(args); const value = wire({status: 'CANCELLED', version: args[2] + 1}); server.active = null; server.trips.set(value.tripId, value); return {data: value};},
    }, routes: {route: async () => ({data: {polyline: {encoding: 'encoded_polyline', precision: 6, value: '???_ibE'}}})},
  };
  const store = new CustomerBookingStore(runtime, new DurableCommand(storage)), stop = store.start();
  return {load, store, runtime, server, calls, stop, BackendError, storage, disk: () => disk, changeOwner: () => epoch++};
}
async function readyDraft(f) {await flush(); f.store.setPoint('pickup', pickup); f.store.setPoint('destination', destination); await f.store.estimate(); f.store.goTo('confirm');}
function assigned(version = 3) {return wire({version, status: 'DRIVER_ARRIVED'});}

test('Customer final confirmation locks two taps immediately and creates once only after a fresh active read', async t => {
  const f = setup(); t.after(f.stop); await readyDraft(f);
  const wait = deferred(); f.runtime.trips.active = () => wait.promise;
  const first = f.store.create(), second = f.store.create(); assert.equal(f.store.getSnapshot().busy, true); assert.equal(f.calls.create.length, 0);
  f.runtime.trips.active = async () => ({data: f.server.active}); wait.resolve({data: null}); await Promise.all([first, second]);
  assert.equal(f.calls.create.length, 1); assert.equal(f.store.getSnapshot().current.status, 'SEARCHING'); assert.equal(f.store.getSnapshot().checked, true); assert.equal(f.disk(), null);
  assert.equal(f.store.getSnapshot().commandResult.phase, 'confirmed'); assert.equal(f.store.draftLocked, true);
});

test('Customer quote expiring during confirmation read sends nothing; failed verification sends nothing', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const f = setup(); t.after(f.stop); await readyDraft(f);
  const wait = deferred(); f.runtime.trips.active = () => wait.promise;
  const work = f.store.create(); await flush(); now += 301000; wait.resolve({data: null}); await work;
  assert.equal(f.calls.create.length, 0); assert.equal(f.disk(), null); assert.equal(f.store.getSnapshot().commandResult.phase, 'rejected');
  f.runtime.trips.active = async () => ({data: null}); await readyDraft(f);
  f.runtime.trips.active = async () => ({data: null, serverDate: now + 360000}); await f.store.create(); assert.equal(f.calls.create.length, 0); assert.equal(f.store.getSnapshot().quote, null);
  f.runtime.trips.active = async () => ({data: null}); await readyDraft(f);
  f.runtime.trips.active = async () => {throw new f.BackendError('NETWORK_ERROR');}; await f.store.create();
  assert.equal(f.calls.create.length, 0); assert.equal(f.store.getSnapshot().checked, false); assert.equal(f.store.getSnapshot().commandResult.phase, 'rejected');
});

test('Customer create timeout preserves exact intent; expired/missing quote does not prevent replay and replay cannot roll version back', async t => {
  const f = setup(); t.after(f.stop); await readyDraft(f);
  f.runtime.trips.create = async (...args) => {f.calls.create.push(args); f.server.active = wire({status: 'ASSIGNED', version: 2}); throw new f.BackendError('TIMEOUT');};
  await f.store.create(); const pending = structuredClone(f.disk()); assert.ok(pending); assert.equal(f.store.getSnapshot().commandResult.phase, 'uncertain');
  assert.equal(f.store.getSnapshot().quote, null); assert.equal(f.store.getSnapshot().current.version, 2);
  await f.store.create(); assert.equal(f.calls.create.length, 1);
  f.server.active = wire({status: 'IN_PROGRESS', version: 4}); await f.store.refresh();
  f.runtime.trips.create = async (...args) => {f.calls.create.push(args); return {data: wire()};}; await f.store.retryCommand();
  assert.deepEqual(f.calls.create[1], f.calls.create[0]); assert.equal(f.calls.create[1][2], pending.key); assert.equal(f.store.getSnapshot().current.version, 4); assert.equal(f.disk(), null);
});

test('Customer restart restores pending create before commands; no POST occurs until explicit retry', async t => {
  let disk = null; const storage = {read: async () => disk, write: async value => {disk = value;}};
  const server = {active: wire({status: 'ASSIGNED', version: 2}), trips: new Map()};
  const intent = {operation: 'create', key: ids.other, body: {quoteId: ids.offer}}; disk = intent;
  const f = setup({storage, server}); t.after(f.stop); assert.equal(f.store.draftLocked, true); await flush();
  assert.equal(f.calls.create.length, 0); assert.deepEqual(f.store.commands.getSnapshot().pending, intent); assert.equal(f.store.getSnapshot().current.version, 2);
  f.runtime.trips.create = async (...args) => {f.calls.create.push(args); return {data: wire()};}; await f.store.retryCommand();
  assert.equal(f.calls.create[0][2], intent.key); assert.equal(f.store.getSnapshot().current.version, 2); assert.equal(disk, null);
});

test('Customer active null keeps known trip until detail proves terminal; errors and 404 cannot mean no trip', async t => {
  const f = setup(); t.after(f.stop); f.server.active = assigned(); f.server.trips.set(ids.trip, assigned()); await f.store.refresh();
  f.server.active = null; await f.store.refresh();
  assert.equal(f.store.getSnapshot().current.status, 'DRIVER_ARRIVED'); assert.equal(f.store.getSnapshot().checked, false); assert.equal(f.store.cancellationAllowed, false); assert.equal(f.store.canStartNewBooking, false);
  f.server.trips.delete(ids.trip); await f.store.refresh(); assert.equal(f.store.getSnapshot().current.version, 3); assert.equal(f.store.getSnapshot().checked, false);
  f.server.trips.set(ids.trip, wire({status: 'COMPLETED', version: 5, fare: {currency: 'VND', estimatedAmount: '9007199254740993', finalAmount: '9007199254740993'}})); await f.store.refresh();
  assert.equal(f.store.getSnapshot().current.status, 'COMPLETED'); assert.equal(f.store.canStartNewBooking, true);
  await f.store.refresh(); assert.equal(f.store.getSnapshot().current.status, 'COMPLETED');
  f.store.newBooking(); await flush(); assert.equal(f.store.getSnapshot().current, null); assert.equal(f.store.draftLocked, false); assert.equal(f.store.getSnapshot().draft.pickup, null);
});

test('Customer older REST and terminal rollback are refused; cached data remains visible after network error', async t => {
  const f = setup(); t.after(f.stop); f.server.active = wire({status: 'IN_PROGRESS', version: 4}); await f.store.refresh();
  f.server.active = wire({status: 'ASSIGNED', version: 2}); await f.store.refresh(); assert.equal(f.store.getSnapshot().current.version, 4); assert.equal(f.store.getSnapshot().checked, false);
  f.runtime.trips.active = async () => {throw new f.BackendError('NETWORK_ERROR');}; await f.store.refresh(); assert.equal(f.store.getSnapshot().current.version, 4);
  f.runtime.trips.active = async () => ({data: null}); f.server.trips.set(ids.trip, wire({status: 'CANCELLED', version: 5})); await f.store.refresh();
  f.runtime.trips.active = async () => ({data: wire({version: 6})}); await f.store.refresh(); assert.equal(f.store.getSnapshot().current.status, 'CANCELLED'); assert.equal(f.store.getSnapshot().checked, false);
});

test('Customer cancellation asks first, reads latest version and refuses if Driver starts during confirmation', async t => {
  const f = setup(); t.after(f.stop); f.server.active = assigned(); await f.store.refresh();
  f.store.requestCancel(); assert.ok(f.store.getSnapshot().cancelConfirmation); assert.equal(f.calls.cancel.length, 0);
  f.server.active = wire({status: 'IN_PROGRESS', version: 4}); await f.store.confirmCancel();
  assert.equal(f.calls.cancel.length, 0); assert.equal(f.store.getSnapshot().cancelConfirmation, null); assert.equal(f.store.getSnapshot().current.status, 'IN_PROGRESS');
  await f.store.confirmCancel(); assert.equal(f.calls.cancel.length, 0);
});

test('Customer cancellation timeout restores from journal/detail and retries same version/key/body', async t => {
  const f = setup(); t.after(f.stop); f.server.active = assigned(); await f.store.refresh();
  const cancelled = wire({status: 'CANCELLED', version: 4});
  f.runtime.trips.cancel = async (...args) => {f.calls.cancel.push(args); f.server.active = null; f.server.trips.set(ids.trip, cancelled); throw new f.BackendError('TIMEOUT');};
  f.store.requestCancel(); await f.store.confirmCancel(); const intent = structuredClone(f.disk()); assert.ok(intent); assert.equal(intent.body.version, 3);
  assert.equal(f.store.getSnapshot().current.status, 'CANCELLED'); assert.equal(f.store.canStartNewBooking, false);
  const g = setup({pending: intent, server: f.server}); t.after(g.stop); await flush(); assert.equal(g.store.getSnapshot().current.status, 'CANCELLED'); assert.equal(g.calls.cancel.length, 0);
  g.runtime.trips.cancel = async (...args) => {g.calls.cancel.push(args); return {data: cancelled};}; await g.store.retryCommand();
  assert.deepEqual(g.calls.cancel[0], f.calls.cancel[0]); assert.equal(g.disk(), null); assert.equal(g.store.canStartNewBooking, true);
});

test('Customer cancellation 409 reconciles Driver start, reports rejection and does not retry with a new key', async t => {
  const f = setup(); t.after(f.stop); f.server.active = assigned(); await f.store.refresh();
  f.runtime.trips.cancel = async (...args) => {f.calls.cancel.push(args); f.server.active = wire({status: 'IN_PROGRESS', version: 4}); throw new f.BackendError('VERSION_CONFLICT', 409);};
  f.store.requestCancel(); await f.store.confirmCancel();
  assert.equal(f.store.getSnapshot().current.version, 4); assert.equal(f.store.getSnapshot().commandResult.phase, 'rejected'); assert.equal(f.disk(), null); assert.equal(f.store.cancellationAllowed, false);
  await f.store.retryCommand(); assert.equal(f.calls.cancel.length, 1);
});

test('Customer socket event bursts coalesce behind REST and leave at most one in-flight read', async t => {
  const f = setup(); t.after(f.stop); await flush();
  const wait = deferred(); let calls = 0, concurrent = 0, max = 0;
  f.runtime.trips.active = async () => {const index = ++calls; concurrent++; max = Math.max(max, concurrent); try {return index === 1 ? await wait.promise : {data: wire({status: 'IN_PROGRESS', version: 4})};} finally {concurrent--;}};
  const first = f.store.refresh(); await flush();
  for (let i = 0; i < 20; i++) void f.store.invalidate();
  wait.resolve({data: wire()}); await first;
  assert.equal(calls, 2); assert.equal(max, 1); assert.equal(f.store.getSnapshot().current.version, 4);
});

test('Customer command invalidates an old GET, waits without overlapping reads and checks a new snapshot before POST', async t => {
  const f = setup(); t.after(f.stop); await readyDraft(f); const wait = deferred();
  f.runtime.trips.active = () => wait.promise; const oldRead = f.store.refresh(); await flush();
  f.runtime.trips.active = async () => ({data: f.server.active});
  const create = f.store.create(); await flush(); assert.equal(f.calls.create.length, 0);
  wait.resolve({data: wire({tripId: ids.other, version: 10})}); await Promise.all([oldRead, create]);
  assert.equal(f.calls.create.length, 1); assert.equal(f.store.getSnapshot().current.tripId, ids.trip);
});

test('Customer old-owner read/command responses cannot publish or erase uncertain command persistence', async t => {
  const f = setup(); t.after(f.stop); await readyDraft(f); const wait = deferred();
  f.runtime.trips.create = async (...args) => {f.calls.create.push(args); return wait.promise;};
  const create = f.store.create(); await flush(); const pending = structuredClone(f.disk()); assert.ok(pending);
  f.changeOwner(); wait.resolve({data: wire()}); await create;
  assert.equal(f.store.getSnapshot().current, null); assert.deepEqual(f.disk(), pending); assert.notEqual(f.store.getSnapshot().commandResult.phase, 'confirmed');
  const g = setup(); t.after(g.stop); await flush(); const reading = deferred(); g.runtime.trips.active = () => reading.promise;
  const job = g.store.refresh(); await flush(); g.changeOwner(); reading.resolve({data: wire()}); await job; assert.equal(g.store.getSnapshot().current, null);
});

test('Customer old create receipt cannot replace a different active Trip found during restart recovery', async t => {
  const intent = {key: ids.other, operation: 'create', body: {quoteId: ids.offer}}, f = setup({pending: intent}); t.after(f.stop);
  f.server.active = wire({tripId: ids.other, status: 'ASSIGNED', version: 2}); await flush();
  f.runtime.trips.create = async (...args) => {f.calls.create.push(args); return {data: wire()};}; await f.store.retryCommand();
  assert.equal(f.store.getSnapshot().current.tripId, ids.other); assert.equal(f.disk(), null); assert.equal(f.store.canStartNewBooking, false);
});

test('Customer pending create after restart discovers a completed Trip through exact replay then authoritative detail', async t => {
  const intent = {key: ids.other, operation: 'create', body: {quoteId: ids.offer}}, f = setup({pending: intent}); t.after(f.stop); await flush();
  const completed = wire({status: 'COMPLETED', version: 5, fare: {currency: 'VND', estimatedAmount: '9007199254740993', finalAmount: '9007199254740993'}});
  f.server.trips.set(ids.trip, completed); assert.equal(f.store.canStartNewBooking, false);
  f.runtime.trips.create = async (...args) => {f.calls.create.push(args); return {data: wire()};}; await f.store.retryCommand();
  assert.equal(f.calls.create[0][2], intent.key); assert.equal(f.store.getSnapshot().current.version, 5); assert.equal(f.store.getSnapshot().current.status, 'COMPLETED'); assert.equal(f.store.canStartNewBooking, true);
});

test('Customer journal clear failure after server success keeps both receipt and pending intent until safe retry', async t => {
  let disk = null, failClear = true;
  const storage = {read: async () => disk, write: async value => {if (value === null && failClear) throw Error('storage unavailable'); disk = value;}};
  const f = setup({storage}); t.after(f.stop); await readyDraft(f); await f.store.create();
  assert.equal(f.store.getSnapshot().current.status, 'SEARCHING'); assert.equal(f.store.getSnapshot().commandResult.phase, 'uncertain'); const original = structuredClone(disk); assert.ok(original);
  failClear = false; f.runtime.trips.create = async (...args) => {f.calls.create.push(args); return {data: wire()};}; await f.store.retryCommand();
  assert.deepEqual(f.calls.create[1], f.calls.create[0]); assert.equal(disk, null); assert.equal(f.store.getSnapshot().commandResult.phase, 'confirmed');
});
