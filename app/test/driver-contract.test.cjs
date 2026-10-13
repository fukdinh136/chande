const { test } = require('node:test'), assert = require('node:assert/strict');
const { loader, flush, ids, owner } = require('./helpers/driver.cjs');
function environment(t, values) {
  const previous = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('EXPO_PUBLIC_DRIVER_')));
  for (const key of Object.keys(previous)) delete process.env[key]; Object.assign(process.env, values);
  t.after(() => { for (const key of Object.keys(process.env)) if (key.startsWith('EXPO_PUBLIC_DRIVER_')) delete process.env[key]; Object.assign(process.env, previous); });
}
test('Driver direct capability never falls back to Driver base for Trip/Matching/Realtime/Routing', async t => {
  environment(t, { EXPO_PUBLIC_DRIVER_HTTP_MODE: 'direct', EXPO_PUBLIC_DRIVER_BASE_URL: 'http://driver.test:3003' }); let fetches = 0;
  const load = loader({ 'expo/fetch': { fetch: async () => { fetches++; } } }), config = load('src/features/driver/http/config.ts').loadHttpConfig();
  for (const service of ['trip', 'matching', 'realtime', 'routing']) assert.equal(config.capabilities[service].configured, false);
  const { FetchTransport } = load('src/features/driver/http/transport.ts');
  await assert.rejects(new FetchTransport(config).send({ service: 'routing', method: 'POST', path: '/routes/navigation' }), e => e.code === 'ROUTING_NOT_CONFIGURED'); assert.equal(fetches, 0);
});
test('Driver Gateway normalizes one prefix; direct Driver may independently use public Routing Gateway', async t => {
  environment(t, { EXPO_PUBLIC_DRIVER_HTTP_MODE: 'gateway', EXPO_PUBLIC_DRIVER_GATEWAY_BASE_URL: 'http://gateway.test/api/v1/', EXPO_PUBLIC_DRIVER_GATEWAY_CONTRACT_CONFIRMED: 'true', EXPO_PUBLIC_DRIVER_TRIP_TRUST_CONFIRMED: 'true' });
  const load = loader(), { loadHttpConfig } = load('src/features/driver/http/config.ts'), { route } = load('src/features/driver/http/routes.ts');
  const gateway = loadHttpConfig(); assert.equal(gateway.driverBase, 'http://gateway.test'); assert.equal(route(gateway, 'profile').path, '/api/v1/drivers/me'); assert.equal(gateway.tripBase, 'http://gateway.test');
  process.env.EXPO_PUBLIC_DRIVER_HTTP_MODE = 'direct'; process.env.EXPO_PUBLIC_DRIVER_BASE_URL = 'http://driver.test'; process.env.EXPO_PUBLIC_DRIVER_ROUTING_GATEWAY_BASE_URL = 'http://routing-gateway.test/api/v1';
  const direct = loadHttpConfig(); assert.equal(direct.routingBase, 'http://routing-gateway.test'); assert.equal(direct.tripBase, null); assert.equal(direct.driverBase, 'http://driver.test');
});
test('Driver HTTP Retry-After supports seconds/date, endpoint auth errors retain context', async () => {
  const now = Date.now(), load = loader({ 'expo/fetch': { fetch: async () => new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' }, meta: { requestId: ids.driver } }), { status: 429, headers: { 'Retry-After': '30' } }) } });
  const { retryAfterDeadline } = load('src/features/driver/http/retry-after.ts');
  assert.equal(retryAfterDeadline('30', now, null), now + 30000); assert.equal(retryAfterDeadline('Mon, 12 Oct 2026 01:01:00 GMT', now, 'Mon, 12 Oct 2026 01:00:00 GMT'), now + 60000); assert.equal(retryAfterDeadline('-1', now, null), null); assert.equal(retryAfterDeadline('nonsense', now, null), null);
  const { FetchTransport } = load('src/features/driver/http/transport.ts'), { AuthClient } = load('src/features/driver/clients/auth-client.ts'), { errorText, ApiError } = load('src/features/driver/http/errors.ts');
  const config = { mode: 'direct', driverBase: 'http://driver.test', timeoutMs: 1000 }, auth = new AuthClient(new FetchTransport(config), config);
  await assert.rejects(auth.requestOtp('84900000001'), e => e.context === 'otp-request' && e.status === 429 && e.retryAt >= now + 30000);
  assert.match(errorText(new ApiError('AUTHENTICATION_FAILED', 401, undefined, null, 'otp-verify')), /OTP/); assert.doesNotMatch(errorText(new ApiError('AUTHENTICATION_FAILED')), /thử nghiệm/);
});
test('Driver OTP server cooldown survives remount; 429 without deadline invents no countdown', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 100000 });
  const load = loader(), { DriverLoginManager } = load('src/features/driver/session/login-manager.ts'), { ApiError } = load('src/features/driver/http/errors.ts'); let requests = 0;
  const auth = { requestOtp: async () => { requests++; if (requests > 1) throw new ApiError('RATE_LIMITED', 429); return { challengeId: ids.offer, expiresIn: 300, retryAfterSeconds: 30 }; } }, manager = new DriverLoginManager(auth, owner()); t.after(() => manager.dispose());
  manager.setPhone('84900000001'); let detach = manager.attach(); await manager.requestOtp(); assert.equal(manager.getSnapshot().cooldown, 30); detach(); t.mock.timers.tick(10000); detach = manager.attach(); assert.equal(manager.getSnapshot().cooldown, 20);
  await manager.requestOtp(); assert.equal(requests, 1); t.mock.timers.tick(20000); await manager.requestOtp(); assert.equal(manager.getSnapshot().requestWait, 0); assert.equal(manager.getSnapshot().phone, '84900000001'); assert.equal(requests, 2); detach();
});
test('Driver mapping, validation and Trip projection preserve server truth and missing timestamps', () => {
  const load = loader(), format = load('src/features/driver/presentation/format.ts'), form = load('src/features/driver/presentation/form.ts'), decode = load('src/features/driver/contracts/decode.ts');
  assert.equal(format.vehicleLabel('BIKE'), 'Xe máy'); assert.match(format.vehicleLabel('CAR_4'), /4 chỗ/); assert.match(format.vehicleLabel('CAR_7'), /7 chỗ/); assert.match(format.vehicleLabel('UNKNOWN'), /chưa nhận diện/);
  assert.match(format.availabilityLabel(undefined, false, null), /Đang kiểm tra/); assert.match(format.availabilityLabel(undefined, false, Error('network')), /Chưa xác định/); assert.match(format.availabilityLabel({ desiredStatus: 'OFFLINE' }, false, null), /Đã tắt/);
  const input = { vehicleType: 'BIKE', licensePlate: 'A'.repeat(16), brandModel: 'Test', color: 'Blue' }; assert.ok(form.validateVehicle(input).licensePlate); assert.equal(input.licensePlate.length, 16);
  const value = { tripId: ids.trip, driverId: ids.driver, vehicleId: ids.offer, status: 'CANCELLED', version: 3, pickup: { lat: 21, lng: 105 }, destination: { lat: 22, lng: 106 }, vehicleType: 'BIKE', fare: { currency: 'VND', estimatedAmount: '30000', finalAmount: null }, timestamps: { requestedAt: '2026-10-12T00:00:00Z', assignedAt: null, driverArrivedAt: null, startedAt: null, completedAt: null, cancelledAt: '2026-10-12T00:05:00Z' }, cancellation: { actorType: 'DRIVER', reason: 'Cannot reach pickup', cancelledAt: '2026-10-12T00:05:00Z' } };
  const result = decode.trip(value); assert.equal(result.timestamps.startedAt, null); assert.deepEqual(result.cancellation, value.cancellation); assert.match(format.driverDate(value.timestamps.cancelledAt), /07:05/); assert.equal(format.driverDate(null), 'Chưa có dữ liệu');
});
test('Driver vehicle creation timeout locks further POST and owner change hides old attempt', async () => {
  const load = loader(), { DriverClient } = load('src/features/driver/clients/driver-client.ts'), { ApiError } = load('src/features/driver/http/errors.ts'), session = owner(); let requests = 0;
  session.request = async () => { requests++; throw new ApiError('TIMEOUT'); };
  const driver = new DriverClient(session, { mode: 'direct' }), input = { vehicleType: 'BIKE', licensePlate: 'TEST-1', brandModel: 'Test', color: 'Blue' };
  await assert.rejects(driver.createVehicle(input)); assert.equal(driver.getVehicleCreation().phase, 'uncertain'); await assert.rejects(driver.createVehicle(input), e => e.code === 'VEHICLE_CREATE_PENDING'); assert.equal(requests, 1);
  session.change(ids.other); assert.equal(driver.getVehicleCreation(), null); await flush();
});
