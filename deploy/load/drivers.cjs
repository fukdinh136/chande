// Simulated drivers: go ONLINE, stream GPS over Socket.IO and accept every offer.
//   node deploy/load/drivers.cjs --count 50 --gps-ms 3000 --radius 2000 --ramp 0 --out <file>
// Prints "READY <n>" once every driver streams GPS. SIGINT/SIGTERM sets drivers OFFLINE and writes stats.
const fs = require('node:fs');
const {io} = require('../../service/matching-service/node_modules/socket.io-client');
const {base, center, pause, request, withRateLimit, readJson, writeJson, around, pool, percentile, args, randomUUID} = require('./lib.cjs');

const options = args({count: 50, gpsMs: 3000, radius: 2000, ramp: 0, out: ''});
const all = readJson('drivers.json', []);
if (all.length < options.count) throw new Error(`Only ${all.length} load drivers seeded; run: node deploy/load/accounts.cjs seed --drivers ${options.count}`);
const drivers = all.slice(0, options.count);
const stats = {onlineFailures: 0, gpsSent: 0, gpsAcked: 0, gpsErrors: 0, gpsAckMs: [], offers: 0, accepted: 0, acceptErrors: 0, acceptMs: [], disconnects: 0, errors: {}};
const fail = (key, e) => { const k = key + ':' + (e.code ?? e.status ?? e.message); stats.errors[k] = (stats.errors[k] ?? 0) + 1; };
let stopping = false;

const save = () => writeJson('drivers.json', all.map(({index, driverId, vehicleId, phoneNumber, refreshToken}) => ({index, driverId, vehicleId, phoneNumber, refreshToken})));
// Thousands of refreshes would rewrite the whole file each time; coalesce writes instead.
let saveTimer;
const scheduleSave = () => { saveTimer ??= setTimeout(() => { saveTimer = undefined; save(); }, 1000); };
const startedAt = Date.now(), startedCpu = process.cpuUsage();

// Refresh rotates the token; a lost or revoked one falls back to OTP login (rate limited, slow).
async function refresh(driver) {
  let session;
  try { session = await request('/driver-auth/refresh', {body: {refreshToken: driver.refreshToken}}); } catch (e) {
    if (e.status !== 401) throw e;
    const {phoneNumber} = driver;
    const challenge = await withRateLimit(() => request('/driver-auth/otp/request', {body: {phoneNumber}}), 'otp/request ' + phoneNumber);
    session = await withRateLimit(() => request('/driver-auth/otp/verify', {body: {phoneNumber, challengeId: challenge.challengeId, otp: '123456'}}), 'otp/verify ' + phoneNumber);
  }
  driver.refreshToken = session.refreshToken; driver.token = session.accessToken;
  scheduleSave();
}

// A trip left over from an aborted run is cancelled first. Its reservation is released asynchronously
// (Trip outbox -> Matching), so vehicle selection may still answer 409 for a few seconds.
async function goOnline(driver) {
  await refresh(driver);
  for (let attempt = 1; ; attempt++) {
    const active = await request('/trips/active', {token: driver.token});
    if (active && ['SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(active.status))
      await request(`/trips/${active.tripId}/cancel`, {body: {version: active.version, reason: 'load test cleanup'}, token: driver.token, headers: {'Idempotency-Key': randomUUID()}});
    try {
      await request('/drivers/me/availability', {method: 'PUT', body: {desiredStatus: 'OFFLINE'}, token: driver.token});
      await request('/drivers/me/selected-vehicle', {method: 'PUT', body: {vehicleId: driver.vehicleId}, token: driver.token});
      break;
    } catch (e) {
      if (e.status !== 409 || attempt >= 15) throw e;
      await pause(2000);
    }
  }
  await request('/drivers/me/availability', {method: 'PUT', body: {desiredStatus: 'ONLINE'}, token: driver.token});
}

function sendGps(driver) {
  // Small random walk keeps the driver near its start point.
  driver.position = around(driver.position, 15);
  const started = Date.now(); stats.gpsSent++;
  driver.socket.timeout(5000).emit('driver.location.update', {latitude: driver.position.lat, longitude: driver.position.lng, accuracy: 5, recordedAt: new Date().toISOString()}, (error, receipt) => {
    if (error || receipt?.data?.accepted === false) { stats.gpsErrors++; fail('gps', error ?? {code: receipt?.data?.reason ?? 'REJECTED'}); return; }
    stats.gpsAcked++; stats.gpsAckMs.push(Date.now() - started);
  });
}

async function accept(driver, offer) {
  stats.offers++;
  const started = Date.now();
  try {
    await request(`/matching/offers/${offer.offerId}/accept`, {body: {}, token: driver.token, headers: {'Idempotency-Key': randomUUID()}, expected: [202]});
    stats.accepted++; stats.acceptMs.push(Date.now() - started);
  } catch (e) { stats.acceptErrors++; fail('accept', e); }
}

function connect(driver) {
  return new Promise((resolve, reject) => {
    // Like the app, auth is a callback: Realtime disconnects a socket when its JWT expires, and each reconnect must send the current token.
    const socket = io(base + '/realtime', {transports: ['websocket'], auth: cb => cb({token: driver.token}), reconnection: true});
    const timer = setTimeout(() => reject(new Error('GPS_SOCKET_TIMEOUT')), 10000);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('connect_error', e => { clearTimeout(timer); reject(e); });
    socket.on('disconnect', reason => {
      if (stopping) return;
      stats.disconnects++;
      // Socket.IO does not reconnect after a server-side disconnect (Realtime does this when the JWT expires); the app reconnects itself.
      if (reason === 'io server disconnect') setTimeout(() => { if (!stopping) socket.connect(); }, 1000 + Math.random() * 4000);
    });
    socket.on('driver.trip.offer', m => { void accept(driver, m.data); });
  });
}

function summary() {
  const ms = values => ({count: values.length, p50: percentile(values, 50), p95: percentile(values, 95), max: values.length ? values.reduce((a, b) => (b > a ? b : a)) : null});
  const cpu = process.cpuUsage(startedCpu), simulatorCpuCores = Math.round((cpu.user + cpu.system) / 1000 / Math.max(1, Date.now() - startedAt) * 100) / 100;
  return {drivers: drivers.length, gpsIntervalMs: options.gpsMs, radiusMeters: options.radius, simulatorCpuCores, onlineFailures: stats.onlineFailures, gpsSent: stats.gpsSent, gpsAcked: stats.gpsAcked, gpsErrors: stats.gpsErrors, gpsAckMs: ms(stats.gpsAckMs),
    offers: stats.offers, accepted: stats.accepted, acceptErrors: stats.acceptErrors, acceptHttpMs: ms(stats.acceptMs), disconnects: stats.disconnects, errors: stats.errors};
}

async function stop() {
  if (stopping) return; stopping = true;
  for (const d of drivers) clearInterval(d.timer);
  clearTimeout(saveTimer); save();
  await pool(drivers.filter(d => d.token), 10, async d => {
    try { await request('/drivers/me/availability', {method: 'PUT', body: {desiredStatus: 'OFFLINE'}, token: d.token}); } catch (e) { fail('offline', e); }
    d.socket?.disconnect();
  });
  const result = summary();
  if (options.out) fs.writeFileSync(options.out, JSON.stringify(result, null, 2));
  console.info('DRIVERS ' + JSON.stringify(result, (k, v) => k === 'errors' && !Object.keys(v).length ? undefined : v));
  process.exit(process.exitCode ?? 0);
}
process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('SIGHUP', stop);

(async () => {
  // --ramp N starts at most N drivers per second; 0 means as fast as the pool allows.
  const rampStart = Date.now();
  // One driver failing to come online is recorded and skipped; only more than 5% failures abort the run.
  await pool(drivers, 10, async (driver, i) => {
    if (options.ramp > 0) await pause(Math.max(0, rampStart + i * 1000 / options.ramp - Date.now()));
    try {
      await goOnline(driver);
      driver.position = around(center, options.radius);
      driver.socket = await connect(driver);
    } catch (e) {
      driver.failed = true; stats.onlineFailures++; fail('online', e.cause ?? e);
      if (stats.onlineFailures > drivers.length * 0.05) throw e;
    }
  });
  const online = drivers.filter(d => !d.failed);
  // Stagger the GPS streams so updates spread evenly over each interval.
  await pool(online, online.length, async (driver, i) => {
    await pause(Math.floor(i * options.gpsMs / online.length));
    sendGps(driver); driver.timer = setInterval(() => sendGps(driver), options.gpsMs);
  });
  console.info(`READY ${online.length}`);
  // Access tokens last 15 minutes; refresh REST tokens well before that.
  setInterval(() => { void pool(drivers, 5, d => refresh(d).catch(e => fail('refresh', e))); }, 10 * 60 * 1000).unref();
  setInterval(() => { const s = summary(); console.info(`drivers gps=${s.gpsAcked}/${s.gpsSent} ackP95=${s.gpsAckMs.p95}ms offers=${s.offers} accepted=${s.accepted} errors=${s.acceptErrors + s.gpsErrors}`); }, 15000).unref();
})().catch(async e => { console.error('drivers failed: ' + e.message + (e.cause ? ` (${e.cause.code ?? ''} ${e.cause.message ?? ''})` : '')); process.exitCode = 1; await stop(); });
