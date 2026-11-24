const {test} = require('node:test'), assert = require('node:assert/strict');
const {loader, deferred, flush, ids} = require('./helpers/driver.cjs');
const pickup = {lat: 21.0285, lng: 105.8542, address: 'Điểm đón cũ'}, destination = {lat: 21.0272, lng: 105.8355, address: 'Điểm đến cũ'};
const trip = (patch = {}) => ({tripId: ids.trip, driverId: null, vehicleId: null, status: 'COMPLETED', version: 6, pickup, destination, vehicleType: 'CAR_7', fare: {currency: 'VND', estimatedAmount: '9007199254740993', finalAmount: '9007199254740994'}, ...patch});
const place = (patch = {}) => ({id: ids.offer, label: null, addressText: 'Địa chỉ đã lưu', lat: 21, lng: 105, isDefault: true, ...patch});
function setup(options = {}) {
  const load = loader(), {CustomerBookingStore} = load('src/features/customer/booking-store.ts'), {DurableCommand} = load('src/features/backend/durable-command.ts');
  let epoch = 1; const calls = [];
  const runtime = {session: {getOwnerEpoch: () => epoch, authorized: async work => work('test')},
    trips: {active: async () => ({data: null}), history: async (...args) => {calls.push(args); return {data: {items: [], nextCursor: null}};}, ...options.trips},
    user: {places: async () => [], ...options.user}};
  const commands = new DurableCommand({read: async () => options.pending ?? null, write: async () => {}}), booking = new CustomerBookingStore(runtime, commands), stop = booking.start();
  const {CustomerDataStore} = load('src/features/customer/data-store.ts'), data = new CustomerDataStore(runtime), stopData = data.start();
  return {load, runtime, booking, data, commands, calls, changeOwner: () => epoch++, stop: () => {stop(); stopData();}};
}

test('history filters use backend status, reset cursor and fence old requests even if abort is ignored', async t => {
  const old = deferred(), current = deferred();
  const f = setup({trips: {history: async (_, cursor, status, signal) => {f.calls.push({cursor, status, signal}); return status === 'COMPLETED' ? current.promise : old.promise;}}}); t.after(f.stop); await flush();
  const first = f.booking.loadHistory(); f.booking.setHistoryFilter('COMPLETED');
  assert.equal(f.calls[0].signal.aborted, true); assert.equal(f.calls[1].cursor, undefined); assert.equal(f.calls[1].status, 'COMPLETED');
  current.resolve({data: {items: [trip()], nextCursor: 'completed-page-2'}}); await flush();
  old.resolve({data: {items: [trip({status: 'CANCELLED'})], nextCursor: 'wrong-filter-cursor'}}); await first;
  assert.equal(f.booking.getSnapshot().history.items[0].status, 'COMPLETED'); assert.equal(f.booking.getSnapshot().history.cursor, 'completed-page-2');
});

test('history pagination locks rapid taps, deduplicates pages and retains data/cursor on errors', async t => {
  const more = deferred(); let count = 0;
  const f = setup({trips: {history: async () => {count++; return count === 1 ? {data: {items: [trip(), trip()], nextCursor: 'p2'}} : more.promise;}}}); t.after(f.stop); await flush();
  await f.booking.loadHistory(); assert.equal(f.booking.getSnapshot().history.items.length, 1);
  const a = f.booking.loadHistory(true), b = f.booking.loadHistory(true); assert.equal(count, 2);
  more.reject(Error('PRIVATE_STACK')); await Promise.all([a, b]);
  let history = f.booking.getSnapshot().history; assert.equal(history.items.length, 1); assert.equal(history.cursor, 'p2'); assert.equal(history.failedMore, true); assert.ok(history.error); assert.doesNotMatch(history.error, /PRIVATE_STACK/);
  f.runtime.trips.history = async (_, cursor) => {assert.equal(cursor, 'p2'); return {data: {items: [trip(), trip({tripId: ids.other})], nextCursor: null}};};
  await f.booking.loadHistory(true); assert.equal(f.booking.getSnapshot().history.items.length, 2);
  f.runtime.trips.history = async () => {throw Error('offline');}; await f.booking.loadHistory();
  history = f.booking.getSnapshot().history; assert.equal(history.items.length, 2); assert.ok(history.error);
});

test('history initial error remains unverified; looping cursor and old owner never produce a false empty', async t => {
  const f = setup({trips: {history: async () => {throw Error('offline');}}}); t.after(f.stop); await flush();
  await f.booking.loadHistory(); assert.equal(f.booking.getSnapshot().history.loaded, false); assert.ok(f.booking.getSnapshot().history.error);
  f.runtime.trips.history = async () => ({data: {items: [trip()], nextCursor: 'same'}}); await f.booking.loadHistory(); await f.booking.loadHistory(true);
  assert.equal(f.booking.getSnapshot().history.items.length, 1); assert.ok(f.booking.getSnapshot().history.error);
  const response = deferred(); f.runtime.trips.history = () => response.promise; const request = f.booking.loadHistory(); f.changeOwner(); response.resolve({data: {items: [], nextCursor: null}}); await request;
  assert.equal(f.booking.getSnapshot().history.items.length, 1);
});

test('rebook confirms replacement, copies only valid inputs, drops price and never POSTs', async t => {
  let posts = 0, quotes = 0;
  const f = setup({trips: {create: async () => {posts++;}, estimate: async () => {quotes++;}}}); t.after(f.stop); await flush();
  f.booking.setPoint('pickup', {lat: 20, lng: 104});
  const prompt = await f.booking.rebook(trip()); assert.equal(prompt.kind, 'confirm'); assert.equal(f.booking.getSnapshot().draft.pickup.lat, 20);
  f.booking.setVehicle('CAR_7'); const changed = await f.booking.rebook(trip(), prompt.revision); assert.equal(changed.kind, 'confirm');
  assert.equal((await f.booking.rebook(trip(), changed.revision)).kind, 'ready');
  const state = f.booking.getSnapshot(); assert.deepEqual(state.draft, {pickup, destination, vehicleType: 'CAR_7'}); assert.notEqual(state.draft.pickup, pickup); assert.equal(state.quote, null); assert.equal(state.flow, 'vehicle'); assert.equal(state.editing, false); assert.equal(f.commands.getSnapshot().pending, null); assert.equal(posts, 0); assert.equal(quotes, 0); assert.equal(f.booking.quoteUsable, false);
});

test('rebook cannot overwrite active/unknown/pending state and checks backend immediately before replacing', async t => {
  const f = setup(); t.after(f.stop); await flush();
  f.runtime.trips.active = async () => ({data: trip({status: 'IN_PROGRESS'})}); assert.equal((await f.booking.rebook(trip())).kind, 'blocked'); assert.equal(f.booking.getSnapshot().draft.pickup, null);
  assert.equal((await f.booking.rebook(trip({vehicleType: 'BIKE'}))).kind, 'invalid');
  const g = setup({pending: {key: ids.offer, operation: 'create', body: {quoteId: ids.other}}}); t.after(g.stop); await flush(); assert.equal((await g.booking.rebook(trip())).kind, 'blocked');
  const h = setup({trips: {active: async () => {throw Error('offline');}}}); t.after(h.stop); await flush(); assert.equal((await h.booking.rebook(trip())).kind, 'blocked'); assert.equal(h.booking.getSnapshot().draft.pickup, null);
});

test('rebook invalidates an existing quote/preview and owner change during preflight never copies points', async t => {
  let quotes = 0;
  const f = setup({trips: {estimate: async () => {quotes++; return {data: {quoteId: ids.offer, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300000).toISOString(), fare: {currency: 'VND', amount: '12345'}, route: {distanceMeters: 1000, durationSeconds: 100}}, serverDate: Date.now()};}}}); t.after(f.stop); await flush();
  f.runtime.routes = {route: async () => ({data: {polyline: {encoding: 'encoded_polyline', precision: 6, value: '???_ibE'}}})};
  f.booking.setPoint('pickup', pickup); f.booking.setPoint('destination', destination); await f.booking.estimate(); assert.equal(f.booking.quoteUsable, true); assert.ok(f.booking.getSnapshot().line);
  const prompt = await f.booking.rebook(trip()); assert.equal(prompt.kind, 'confirm'); assert.equal((await f.booking.rebook(trip(), prompt.revision)).kind, 'ready');
  assert.equal(f.booking.getSnapshot().quote, null); assert.equal(f.booking.getSnapshot().line, undefined); assert.equal(f.booking.quoteUsable, false); assert.equal(quotes, 1);
  const g = setup(); t.after(g.stop); await flush(); const wait = deferred(); g.runtime.trips.active = () => wait.promise;
  const request = g.booking.rebook(trip()); g.changeOwner(); wait.resolve({data: null}); assert.equal((await request).kind, 'blocked'); assert.equal(g.booking.getSnapshot().draft.pickup, null);
});

test('address collection shares one read, decodes nullable label and applies server defaults after mutations', async t => {
  let rows = [place()], reads = 0;
  const f = setup({user: {places: async () => {reads++; if (reads > 1) assert.equal(f.data.getSnapshot().busy, true); return rows;}, updatePlace: async (_, id, input) => {rows = [place({...input, id, isDefault: true})]; return rows[0];}, deletePlace: async () => {rows = [];}}}); t.after(f.stop);
  await Promise.all([f.data.load(), f.data.load()]); assert.equal(reads, 1); assert.equal(f.data.getSnapshot().items[0].label, '');
  await flush(); const selected = f.data.getSnapshot().items[0]; f.booking.setPoint('pickup', {...selected, address: selected.addressText}, 'Đã chọn');
  await f.data.save({label: 'Cơ quan', addressText: 'Mới', lat: 22, lng: 106, makeDefault: true}, selected.id);
  assert.equal(f.data.getSnapshot().items[0].lat, 22); assert.equal(f.booking.getSnapshot().draft.pickup.lat, 21);
  await f.data.remove(selected.id); assert.equal(f.data.getSnapshot().items.length, 0); assert.equal(f.booking.getSnapshot().draft.pickup.lat, 21);
});

test('address errors retain cache, acknowledged save survives refresh error, stale GET cannot overwrite write', async t => {
  const stale = deferred(); let reads = 0;
  const f = setup({user: {places: async () => {reads++; if (reads === 1) return [place()]; if (reads === 2) return stale.promise; throw Error('offline');}, updatePlace: async () => place({label: 'Đã sửa', lat: 22})}}); t.after(f.stop);
  await f.data.load(); const read = f.data.load(true); await flush();
  await f.data.save({label: 'Đã sửa', addressText: 'Địa chỉ đã lưu', lat: 22, lng: 105, makeDefault: true}, ids.offer);
  assert.ok(f.data.getSnapshot().error); assert.equal(f.data.getSnapshot().items[0].lat, 22);
  stale.resolve([place()]); await read; assert.equal(f.data.getSnapshot().items[0].lat, 22);
});

test('address mutation locks duplicates and old-account read/save cannot publish or start another fetch', async t => {
  const pending = deferred(); let writes = 0, reads = 0;
  const f = setup({user: {places: async () => {reads++; return [];}, createPlace: async () => {writes++; return pending.promise;}}}); t.after(f.stop);
  const input = {label: 'Nhà', addressText: 'Thử', lat: 21, lng: 105, makeDefault: false};
  const first = f.data.save(input); await assert.rejects(f.data.save(input)); assert.equal(writes, 1);
  f.changeOwner(); pending.resolve(place()); await assert.rejects(first); assert.equal(f.data.getSnapshot().items.length, 0); assert.equal(reads, 0);
  const g = setup({user: {places: () => pending.promise}}); t.after(g.stop); const read = g.data.load(); g.changeOwner(); await read; assert.equal(g.data.getSnapshot().loaded, false);
});

test('account validation mirrors HTTP avatar/no-clear, optional address label, UTF-8 password and ranges', () => {
  const load = loader(), {validateProfile, validatePlace, validatePassword} = load('src/features/customer/account-form.ts');
  assert.deepEqual(validateProfile('Tên', 'http://example.test/a', null), {}); assert.ok(validateProfile('Tên', '', 'https://example.test/old').avatarUrl);
  assert.ok(validateProfile(' ', 'not-url', null).fullName); assert.ok(validateProfile('Tên', 'not-url', null).avatarUrl);
  assert.deepEqual(validatePlace({label: '', addressText: 'Địa chỉ', lat: '90', lng: '-180', makeDefault: true}).errors, {});
  assert.ok(validatePlace({label: 'x'.repeat(51), addressText: '', lat: '', lng: '181', makeDefault: false}).errors.lat);
  assert.deepEqual(validatePassword('OldPass123', 'NewPass123', 'NewPass123'), {}); assert.ok(validatePassword('OldPass123', 'OldPass123', 'OldPass123').newPassword);
  assert.ok(validatePassword('OldPass123', 'á'.repeat(35) + 'Ab1', 'á'.repeat(35) + 'Ab1').newPassword); assert.ok(validatePassword('x', 'NewPass123', 'wrong').confirmation);
});

test('profile/password success updates session or logs out; delayed old-account success cannot affect new user', async () => {
  const load = loader(), {UserSession} = load('src/features/backend/user-session.ts');
  let actor = ids.driver, passwordResult = {passwordChanged: true}, savedToken = null; const pending = deferred();
  const profile = () => ({id: actor, fullName: 'Tên', avatarUrl: null, phoneNumber: '+84912345678', createdAt: '2026-01-01T00:00:00Z'});
  const api = {login: async () => ({accessToken: 't', refreshToken: 'r', expiresIn: 900}), profile: async () => profile(), logout: async () => {}, updateProfile: async () => ({...profile(), fullName: 'Đã lưu'}), changePassword: async () => passwordResult};
  const session = new UserSession(api, {read: async () => null, write: async value => {savedToken = value;}}); await session.login('', '');
  await session.saveProfile({fullName: 'Đã lưu'}); assert.equal(session.getSnapshot().session.profile.fullName, 'Đã lưu');
  passwordResult = {}; await assert.rejects(session.changePassword('a', 'b')); assert.ok(session.getSnapshot().session);
  api.updateProfile = () => pending.promise; const saving = session.saveProfile({fullName: 'Cũ'}); await flush(); await session.logout(); actor = ids.other; await session.login('', ''); pending.resolve({...profile(), id: ids.driver, fullName: 'Không được hiện'}); await assert.rejects(saving);
  assert.equal(session.getSnapshot().session.profile.id, ids.other); assert.equal(session.getSnapshot().session.profile.fullName, 'Tên');
  passwordResult = {passwordChanged: true}; await session.changePassword('a', 'b'); assert.equal(session.getSnapshot().session, null); assert.equal(savedToken, null);
});

test('Customer adapter passes filter/cursor as query and decoder retains exact breakdown/route', async () => {
  const load = loader(), calls = [], {CustomerTripApi} = load('src/features/backend/clients.ts'), {trip: decode} = load('src/features/driver/contracts/decode.ts');
  const api = new CustomerTripApi({send: async input => {calls.push(input); return {data: null};}}), control = new AbortController();
  await api.history('token', 'opaque+cursor', 'CANCELLED', control.signal); assert.deepEqual(calls[0].query, {limit: '20', cursor: 'opaque+cursor', status: 'CANCELLED'}); assert.equal(calls[0].signal, control.signal);
  const result = decode(trip({route: {distanceMeters: 2000, durationSeconds: 300}, fare: {currency: 'VND', estimatedAmount: '9007199254740993', finalAmount: null, breakdown: [{code: 'BASE_FARE', amount: '9007199254740993'}]}})); assert.equal(result.fare.breakdown[0].amount, '9007199254740993'); assert.equal(result.route.durationSeconds, 300);
});

test('address store restarts cleanly after cleanup and ignores the abandoned request', async t => {
  const old = deferred(); let count = 0;
  const f = setup({user: {places: async () => ++count === 1 ? old.promise : [place({label: 'Mới'})]}}); t.after(f.stop);
  const first = f.data.load(); await flush(); f.stop(); const stopAgain = f.data.start(); t.after(stopAgain);
  await f.data.load(); assert.equal(f.data.getSnapshot().items[0].label, 'Mới'); old.resolve([place({label: 'Cũ'})]); await first; assert.equal(f.data.getSnapshot().items[0].label, 'Mới');
});

test('aborted profile save does not overwrite profile from a later form', async () => {
  const load = loader(), {UserSession} = load('src/features/backend/user-session.ts'), pending = deferred();
  const profile = {id: ids.driver, fullName: 'Ban đầu', avatarUrl: null}; let calls = 0;
  const session = new UserSession({login: async () => ({accessToken: 't', refreshToken: 'r', expiresIn: 900}), profile: async () => profile, updateProfile: async () => ++calls === 1 ? pending.promise : {...profile, fullName: 'Mới'}, logout: async () => {}}, {read: async () => null, write: async () => {}});
  await session.login('', ''); const control = new AbortController(), first = session.saveProfile({fullName: 'Cũ'}, control.signal); await flush(); control.abort(); await session.saveProfile({fullName: 'Mới'}); pending.resolve({...profile, fullName: 'Cũ'}); await assert.rejects(first); assert.equal(session.getSnapshot().session.profile.fullName, 'Mới');
});
