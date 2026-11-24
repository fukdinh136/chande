const {test} = require('node:test'), assert = require('node:assert/strict');
const {randomInt, randomBytes, randomUUID} = require('node:crypto');
const {io} = require('socket.io-client');
const {loader, flush} = require('./helpers/driver.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accept, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {const value = await read(); if (accept(value)) return value; await pause(500);}
  throw Error('Customer verification deadline exceeded');
}

test('Customer real stores: lost create/cancel receipt, restore, assigned/completed, history/rebook and account', {skip: process.env.CUSTOMER_APP_INTEGRATION !== '1', timeout: 150000}, async () => {
  const base = process.env.APP_BACKEND_URL;
  assert.equal(base, 'http://127.0.0.1:18082');
  assert.equal(process.env.DRIVER_TEST_STORAGE_ACK, 'ISOLATED_DRIVER_TEST_ONLY');
  const load = loader(), {BackendHttp, BackendError} = load('src/features/backend/http.ts');
  const {UserApi, CustomerTripApi, PreviewApi} = load('src/features/backend/clients.ts'), {UserSession} = load('src/features/backend/user-session.ts');
  const {CustomerBookingStore} = load('src/features/customer/booking-store.ts'), {CustomerDataStore} = load('src/features/customer/data-store.ts'), {DurableCommand} = load('src/features/backend/durable-command.ts'), {TripEvents} = load('src/features/backend/trip-events.ts');
  const http = new BackendHttp(base), user = new UserApi(http), trips = new CustomerTripApi(http);
  const phone = '+849' + String(randomInt(100000000)).padStart(8, '0'), password = 'C5a1' + randomBytes(12).toString('hex'), nextPassword = 'C5b2' + randomBytes(12).toString('hex');
  let savedRefresh = null, journal = null, stop, stopData, socket, timer, driver, oldAvailability, events, removeEvent;
  const storage = {read: async () => savedRefresh, write: async value => {savedRefresh = value;}};
  let session = new UserSession(user, storage), store, data;
  const runtime = {base, user, trips, session, routes: new PreviewApi(http)};
  const commandStorage = {read: async () => journal, write: async value => {journal = value;}};
  const keys = [], cancelCommands = []; let lostCreate = true, lostCancel = true;
  const create = trips.create.bind(trips), cancel = trips.cancel.bind(trips);
  trips.create = async (...args) => {keys.push(args[2]); const result = await create(...args); if (lostCreate) {lostCreate = false; throw new BackendError('TIMEOUT');} return result;};
  trips.cancel = async (...args) => {cancelCommands.push(args.slice(1)); const result = await cancel(...args); if (lostCancel) {lostCancel = false; throw new BackendError('TIMEOUT');} return result;};
  const request = async (path, method = 'GET', body, token) => (await http.send({service: 'driver', path, method, body, token})).data;
  try {
    await user.register(phone, password, 'Nghiệm thu Customer 5'); await session.login(phone, password);
    data = new CustomerDataStore(runtime); stopData = data.start(); await data.load();
    const address = await data.save({label: '', addressText: 'Điểm kiểm thử Hà Nội', lat: 21.0285, lng: 105.8542, makeDefault: false}); assert.equal(address.isDefault, true);
    store = new CustomerBookingStore(runtime, new DurableCommand(commandStorage)); stop = store.start(); await until(async () => store.getSnapshot(), state => state.checked && !state.commandsLoading);
    store.setPoint('pickup', {lat: address.lat, lng: address.lng, address: address.addressText}); store.setPoint('destination', {lat: 21.0272, lng: 105.8355});
    await data.save({label: 'Đã sửa', addressText: 'Nguồn đã sửa', lat: 21.029, lng: 105.855, makeDefault: true}, address.id);
    await data.remove(address.id); assert.equal(store.getSnapshot().draft.pickup.lat, 21.0285); assert.equal(data.getSnapshot().items.length, 0);
    const challenge = await request('/driver-auth/otp/request', 'POST', {phoneNumber: '84900000004'});
    driver = await request('/driver-auth/otp/verify', 'POST', {phoneNumber: '84900000004', challengeId: challenge.challengeId, otp: '123456'});
    oldAvailability = await request('/drivers/me/availability', 'GET', undefined, driver.accessToken);
    assert.equal((await http.send({service: 'trip', path: '/trips/active', token: driver.accessToken})).data, null);
    await request('/drivers/me/availability', 'PUT', {desiredStatus: 'OFFLINE'}, driver.accessToken);
    const vehicles = await request('/drivers/me/vehicles', 'GET', undefined, driver.accessToken), vehicle = vehicles.items.find(item => item.vehicleType === 'CAR_4' && item.isActive);
    assert.ok(vehicle); await request('/drivers/me/selected-vehicle', 'PUT', {vehicleId: vehicle.vehicleId}, driver.accessToken); await request('/drivers/me/availability', 'PUT', {desiredStatus: 'ONLINE'}, driver.accessToken);
    socket = io(base + '/realtime', {transports: ['websocket'], auth: {token: driver.accessToken}, reconnection: false});
    await new Promise((resolve, reject) => {socket.once('connect', resolve); socket.once('connect_error', reject);});
    const gps = () => new Promise((resolve, reject) => socket.timeout(5000).emit('driver.location.update', {latitude: 21.0295, longitude: 105.8542, accuracy: 5, recordedAt: new Date().toISOString()}, (error, result) => error ? reject(error) : result?.data?.accepted ? resolve() : reject(Error('GPS not accepted'))));
    await gps(); timer = setInterval(() => {void gps().catch(() => {});}, 10000);
    await store.estimate(); assert.equal(typeof store.getSnapshot().quote.amount, 'string');
    await Promise.all([store.create(), store.create()]); assert.equal(keys.length, 1); assert.ok(journal);
    const pending = store.commands.getSnapshot().pending, firstId = store.getSnapshot().current.tripId; stop();
    session = new UserSession(user, storage); await session.restore(); runtime.session = session;
    store = new CustomerBookingStore(runtime, new DurableCommand(commandStorage)); stop = store.start(); await until(async () => store.getSnapshot(), state => state.checked && !state.commandsLoading);
    assert.equal(keys.length, 1); assert.deepEqual(store.commands.getSnapshot().pending, pending); assert.equal(store.getSnapshot().current.tripId, firstId);
    await store.retryCommand(); assert.equal(keys[0], keys[1]); assert.equal(journal, null);
    let notifications = 0; events = new TripEvents(base, () => session.token(), undefined, undefined, {role: 'RIDER', userId: () => session.getSnapshot().session?.profile.id}); removeEvent = events.subscribe(() => {notifications++; void store.invalidate();}); events.start();
    const offer = await until(async () => (await http.send({service: 'matching', path: '/matching/offers/active', token: driver.accessToken})).data, offer => offer?.tripId === firstId && offer.status === 'PENDING');
    await http.send({service: 'matching', path: `/matching/offers/${offer.offerId}/accept`, method: 'POST', body: {}, token: driver.accessToken, key: randomUUID()});
    let current = await until(async () => {await store.refresh(); return store.getSnapshot().current;}, trip => trip?.status === 'ASSIGNED'); assert.equal(current.driverId, driver.driver.driverId);
    store.setForeground(false);
    current = (await http.send({service: 'trip', path: `/trips/${firstId}/status`, method: 'PATCH', body: {status: 'DRIVER_ARRIVED', version: current.version}, key: randomUUID(), token: driver.accessToken})).data;
    store.setForeground(true); await until(async () => store.getSnapshot().current, trip => trip.status === 'DRIVER_ARRIVED');
    for (const status of ['IN_PROGRESS', 'COMPLETED']) {
      current = (await http.send({service: 'trip', path: `/trips/${firstId}/status`, method: 'PATCH', body: {status, version: current.version}, key: randomUUID(), token: driver.accessToken})).data;
      await until(async () => {await store.refresh(); return store.getSnapshot().current;}, trip => trip.status === status);
    }
    assert.equal(store.canStartNewBooking, true); assert.ok(notifications > 0);
    store.setHistoryFilter('COMPLETED'); await until(async () => store.getSnapshot().history, history => history.loaded && !history.loading); assert.equal(store.getSnapshot().history.items[0].tripId, firstId);
    const detail = (await trips.detail(await session.token(), firstId)).data; assert.equal(detail.trip.status, 'COMPLETED'); assert.ok(detail.statusHistory.some(entry => entry.toStatus === 'IN_PROGRESS'));
    let rebook = await store.rebook(store.getSnapshot().current); if (rebook.kind === 'confirm') rebook = await store.rebook(store.getSnapshot().current, rebook.revision); assert.equal(rebook.kind, 'ready'); assert.equal(store.getSnapshot().quote, null);
    await store.create(); assert.equal(keys.length, 2); await store.estimate(); await store.create(); assert.notEqual(keys[2], keys[0]);
    store.requestCancel(); await store.confirmCancel(); assert.ok(store.commands.getSnapshot().pending); assert.equal(store.getSnapshot().current.status, 'CANCELLED'); assert.equal(store.canStartNewBooking, false);
    await store.retryCommand(); assert.deepEqual(cancelCommands[0], cancelCommands[1]); assert.equal(store.commands.getSnapshot().pending, null);
    store.setHistoryFilter('CANCELLED'); await until(async () => store.getSnapshot().history, history => history.loaded && !history.loading); assert.ok(store.getSnapshot().history.items.every(item => item.status === 'CANCELLED'));
    await session.saveProfile({fullName: 'Nghiệm thu Customer đã cập nhật', avatarUrl: 'https://example.invalid/customer-test.png'}); assert.equal(session.getSnapshot().session.profile.fullName, 'Nghiệm thu Customer đã cập nhật');
    await session.changePassword(password, nextPassword); assert.equal(session.getSnapshot().session, null); assert.equal(savedRefresh, null);
    await assert.rejects(user.login(phone, password)); await session.login(phone, nextPassword);
    console.info('Customer live PASS on isolated :18082: real REST/WS, completion/cancellation/history/rebook/profile/addresses/password. Lost POST receipts simulated only at adapter boundary; no native sensor claim.');
  } finally {
    stop?.(); stopData?.(); events?.stop(); removeEvent?.(); if (timer) clearInterval(timer); socket?.disconnect();
    if (session.getSnapshot().session) {
      const current = (await trips.active(await session.token())).data;
      if (current && ['CREATED', 'SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED'].includes(current.status)) await cancel(await session.token(), current.tripId, current.version, 'Customer acceptance cleanup', randomUUID());
      await session.logout();
    }
    if (driver) {
      if (oldAvailability) {await request('/drivers/me/availability', 'PUT', {desiredStatus: 'OFFLINE'}, driver.accessToken); if (oldAvailability.selectedVehicleId) await request('/drivers/me/selected-vehicle', 'PUT', {vehicleId: oldAvailability.selectedVehicleId}, driver.accessToken); await request('/drivers/me/availability', 'PUT', {desiredStatus: oldAvailability.desiredStatus}, driver.accessToken);}
      await request('/driver-auth/logout', 'POST', {refreshToken: driver.refreshToken});
    }
    await flush();
  }
});
