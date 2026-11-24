const { test } = require('node:test'), assert = require('node:assert/strict'), { randomUUID, randomInt } = require('node:crypto');
const { loader, flush } = require('./helpers/driver.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accepts, ms = 45000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { const value = await read(); if (accepts(value)) return value; await delay(500); }
  throw Error('Driver integration deadline reached');
}
test('Driver production adapters/coordinator: profile/vehicle -> real GPS/offer -> assignment -> complete/history', { skip: process.env.DRIVER_APP_INTEGRATION !== '1', timeout: 120000 }, async () => {
  // This suite writes fixture accounts. Permit only the disposable harness ingress.
  const base = process.env.APP_BACKEND_URL;
  assert.equal(process.env.DRIVER_TEST_STORAGE_ACK, 'ISOLATED_DRIVER_TEST_ONLY');
  assert.equal(base, 'http://127.0.0.1:18082');
  const load = loader({ 'expo/fetch': { fetch: globalThis.fetch }, 'react-native': { Platform: { OS: 'web' } } });
  const { FetchTransport } = load('src/features/driver/http/transport.ts'), { AuthClient } = load('src/features/driver/clients/auth-client.ts'), { SessionManager } = load('src/features/driver/session/session-manager.ts'), { DriverStorage } = load('src/features/driver/session/storage.ts');
  const { DriverClient } = load('src/features/driver/clients/driver-client.ts'), { TripClient } = load('src/features/driver/clients/trip-client.ts'), { DriverMatchingClient } = load('src/features/driver/clients/matching-client.ts'), { OfferCoordinator } = load('src/features/driver/state/offer-coordinator.ts'), { TripCommandManager } = load('src/features/driver/state/trip-command-manager.ts');
  const { DriverSocket } = load('src/features/driver/realtime/driver-socket.ts'), { SocketLocationClient } = load('src/features/driver/gps/socket-location-client.ts'), { BackendHttp } = load('src/features/backend/http.ts'), { UserApi, CustomerTripApi, quote } = load('src/features/backend/clients.ts');
  const config = { mode: 'gateway', driverBase: base, tripBase: base, gatewayBase: base, gatewayPrefix: '/api/v1', matchingBase: base, matchingPrefix: '/api/v1', realtimeBase: base, timeoutMs: 10000, capabilities: { matching: { configured: true } } };
  const storage = new DriverStorage('isolated-live'), transport = new FetchTransport(config), auth = new AuthClient(transport, config), session = new SessionManager(auth, transport, storage), driver = new DriverClient(session, config), trips = new TripClient(session, config), matching = new DriverMatchingClient(config, session);
  const coordinator = new OfferCoordinator(matching, session, storage, config), commands = new TripCommandManager(trips, session, storage), connection = new DriverSocket(base, session);
  const gps = new SocketLocationClient(connection, () => {}, () => {}), notices = [];
  connection.subscribeEvents(event => notices.push(event));
  const customerHttp = new BackendHttp(base), users = new UserApi(customerHttp), customerTrips = new CustomerTripApi(customerHttp);
  let rider, created, gpsTimer, oldIntent, oldVehicle, initialProfile;
  try {
    const challenge = await auth.requestOtp('84900000007'); await session.login('84900000007', challenge.challengeId, '123456');
    const driverId = session.getSnapshot().session.driver.driverId; assert.equal(await trips.active(), null);
    initialProfile = await driver.profile(); const edited = await driver.updateProfile({ fullName: 'Isolated Driver Verification' }); assert.equal(edited.fullName, 'Isolated Driver Verification');
    const initial = await driver.availability(); oldIntent = initial.desiredStatus; oldVehicle = initial.selectedVehicleId; await driver.setAvailability('OFFLINE');
    const vehicle = await driver.createVehicle({ vehicleType: 'CAR_7', licensePlate: 'T' + randomUUID().replaceAll('-', '').slice(0, 12), brandModel: 'Verification Car', color: 'Blue' });
    assert.equal(vehicle.isActive, true); assert.equal((await driver.availability()).selectedVehicleId, oldVehicle);
    assert.equal((await driver.selectVehicle(vehicle.vehicleId)).selectedVehicleId, vehicle.vehicleId); await driver.setAvailability('ONLINE');
    await until(() => driver.availability(), value => value.realtimeStatus === 'AVAILABLE');
    gps.start(); await until(async () => connection.getState(), value => value === 'connected', 10000);
    const publish = () => gps.send({ latitude: 21.0295, longitude: 105.8542, accuracy: 5, recordedAt: new Date().toISOString() });
    assert.equal((await publish()).disposition, 'STORED'); gpsTimer = setInterval(() => { void publish().catch(() => {}); }, 10000);
    const phone = '+849' + String(randomInt(100000000)).padStart(8, '0'); await users.register(phone, 'IsolatedTest123!', 'Isolated Driver Flow'); rider = await users.login(phone, 'IsolatedTest123!');
    const estimate = quote((await customerTrips.estimate(rider.accessToken, { lat: 21.0285, lng: 105.8542 }, { lat: 21.0272, lng: 105.8355 }, 'CAR_7')).data);
    created = (await customerTrips.create(rider.accessToken, estimate.quoteId, randomUUID())).data;
    coordinator.start(driverId, () => {}); coordinator.observeActive({ data: null, loading: false, error: null, checkedAt: Date.now() }); coordinator.setForeground(true);
    // Observe the coordinator's polling. Refreshing immediately before every
    // observation would always force loading=true and mask its actionable state.
    await until(async () => coordinator.getSnapshot(), value => value.data?.tripId === created.tripId && value.canAccept);
    let posts = 0; const request = session.request.bind(session); session.request = spec => { if (spec.service === 'matching' && spec.method === 'POST') posts++; return request(spec); };
    for (let i = 0; i < 10; i++) coordinator.decide('accept');
    await until(async () => coordinator.getSnapshot(), value => !value.busy && value.phase === 'awaiting-assignment'); assert.equal(posts, 1);
    let trip = await until(() => trips.active(), value => value?.tripId === created.tripId && value.status === 'ASSIGNED'); assert.equal(trip.driverId, driverId); assert.equal(trip.vehicleId, vehicle.vehicleId);
    coordinator.observeActive({ data: trip, loading: false, error: null, checkedAt: Date.now() }); assert.equal(coordinator.getSnapshot().phase, 'confirmed');
    assert.ok(notices.includes('offer-invalidated')); await commands.initialize(driverId);
    for (const expected of ['DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED']) {
      await Promise.all([commands.advance(trip), commands.advance(trip)]); assert.equal(commands.getSnapshot().error, null); assert.equal(commands.getSnapshot().pending, null);
      trip = (await trips.detail(trip.tripId)).trip; assert.equal(trip.status, expected);
    }
    assert.equal(await trips.active(), null); const historical = (await trips.history()).items.find(item => item.tripId === created.tripId);
    assert.equal(historical.status, 'COMPLETED'); assert.ok(historical.timestamps.startedAt); assert.ok(historical.timestamps.completedAt); assert.equal(historical.fare.currency, 'VND');
    await until(() => matching.active(), value => value === null);
    console.info('Driver live: real PostgreSQL/Redis, Gateway, Realtime, RabbitMQ, Matching worker, Trip worker and OSRM; completed/history confirmed.');
  } finally {
    if (gpsTimer) clearInterval(gpsTimer); gps.stop(); connection.dispose(); coordinator.stop(); commands.dispose();
    if (rider && created) {
      const active = (await customerTrips.active(rider.accessToken)).data;
      if (active?.tripId === created.tripId && ['CREATED', 'SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED'].includes(active.status)) await customerTrips.cancel(rider.accessToken, active.tripId, active.version, 'isolated verification cleanup', randomUUID());
    }
    if (session.getSnapshot().usable) {
      if (initialProfile) await driver.updateProfile({ fullName: initialProfile.fullName });
      if (oldIntent) { await driver.setAvailability('OFFLINE'); if (oldVehicle && !await trips.active()) await driver.selectVehicle(oldVehicle); await driver.setAvailability(oldIntent); }
    }
    if (rider) await users.logout(rider.refreshToken); await session.logout(); session.dispose(); await flush();
  }
});
