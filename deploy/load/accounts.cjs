// Creates and refreshes load-test accounts in the local Kubernetes stack.
//   node deploy/load/accounts.cjs seed --drivers 50 --riders 40
//   node deploy/load/accounts.cjs tokens   (fresh rider access tokens for k6)
//   node deploy/load/accounts.cjs cleanup  (cancel active rider trips)
//   node deploy/load/accounts.cjs sessions --drivers N  (new OTP sessions for drivers 1..N)
// Drivers are inserted with SQL (Driver has no sign-up API) and tagged with id prefix 30000000-/plate LOAD-.
// Rider sessions go through the Gateway (rate limited); driver OTP runs inside driver-api with per-driver client IPs. Resumable.
const {request, withRateLimit, readJson, writeJson, kubectl, pool, args, randomUUID} = require('./lib.cjs');

const options = args({drivers: 50, riders: 40});
const driverId = i => '30000000-0000-4000-8000-' + String(i).padStart(12, '0');
const vehicleId = i => '31000000-0000-4000-8000-' + String(i).padStart(12, '0');
const driverPhone = i => '8496' + String(i).padStart(7, '0');

function insertDrivers(count) {
  const sql = `
INSERT INTO drivers(id,phone_number,password_hash,full_name,license_number,status)
SELECT ('30000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'8496'||lpad(i::text,7,'0'),'local-otp-fixture','Load Driver '||i,'LOAD-'||lpad(i::text,6,'0'),'OFFLINE'
FROM generate_series(1,${count}) i ON CONFLICT DO NOTHING;
INSERT INTO vehicles(id,driver_id,vehicle_type,license_plate,brand_model,color,is_active)
SELECT ('31000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('30000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'CAR_4','LOAD-'||lpad(i::text,6,'0'),'Load Car','White',true
FROM generate_series(1,${count}) i ON CONFLICT DO NOTHING;
SELECT count(*) FROM drivers WHERE id::text LIKE '30000000-%';`;
  const out = kubectl(['exec', '-i', 'deploy/postgres', '--', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d driver_db -v ON_ERROR_STOP=1 -tA'], sql);
  console.info(`Load drivers in driver_db: ${out.trim().split('\n').pop()}`);
}

// Runs inside the driver-api pod and calls it on localhost. The OTP mock allows 10 requests/min per client IP,
// so each driver presents its own address through the trusted-proxy headers (GATEWAY_PROXY_TOKEN in the local stack).
const OTP_IN_POD = `
const phones = JSON.parse(require('fs').readFileSync(0, 'utf8')), base = 'http://127.0.0.1:' + (process.env.PORT || 3003);
const post = async (path, body, ip) => { const r = await fetch(base + path, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Driver-Proxy-Token': process.env.GATEWAY_PROXY_TOKEN, 'X-Driver-Client-IP': ip}, body: JSON.stringify(body)}); const j = await r.json(); if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + (j.error?.code ?? '')); return j.data; };
(async () => { let next = 0; await Promise.all(Array.from({length: 10}, async () => { while (next < phones.length) {
  const {index, phoneNumber} = phones[next++], ip = '198.18.' + (index >> 8) + '.' + (index & 255);
  const challenge = await post('/driver-auth/otp/request', {phoneNumber}, ip);
  const session = await post('/driver-auth/otp/verify', {phoneNumber, challengeId: challenge.challengeId, otp: '123456'}, ip);
  console.log(JSON.stringify({index, refreshToken: session.refreshToken}));
} })); })().catch(e => { console.error(e.message); process.exit(1); });`;

// fresh=true replaces the sessions of drivers 1..count (rotated refresh tokens are lost when a run is killed).
async function seedDrivers(count, fresh = false) {
  insertDrivers(count);
  const kept = readJson('drivers.json', []), drivers = fresh ? [] : kept;
  for (let start = drivers.length + 1; start <= count; start += 500) {
    const batch = Array.from({length: Math.min(500, count - start + 1)}, (_, k) => ({index: start + k, phoneNumber: driverPhone(start + k)}));
    const out = kubectl(['exec', '-i', 'deploy/driver-api', '--', 'node', '-e', OTP_IN_POD], JSON.stringify(batch));
    const sessions = new Map(out.trim().split('\n').map(line => JSON.parse(line)).map(s => [s.index, s.refreshToken]));
    for (const {index, phoneNumber} of batch) {
      if (!sessions.has(index)) throw new Error('Missing OTP session for driver ' + index);
      drivers.push({index, driverId: driverId(index), vehicleId: vehicleId(index), phoneNumber, refreshToken: sessions.get(index)});
    }
    writeJson('drivers.json', fresh ? [...drivers, ...kept.slice(drivers.length)] : drivers);
    console.info(`driver sessions ${drivers.length}/${count}`);
  }
}

// Riders 1..80 of older seeds used time-based numbers (+8497...); new riders use +8498 + index so parallel seeding never collides.
async function seedRiders(count) {
  const riders = readJson('riders.json', []), password = 'LoadRider123!';
  const missing = Array.from({length: Math.max(0, count - riders.length)}, (_, k) => riders.length + 1 + k);
  try {
    await pool(missing, 10, async i => {
      const phoneNumber = '+8498' + String(i).padStart(7, '0');
      try { await withRateLimit(() => request('/auth/register', {body: {phoneNumber, password, fullName: 'Load Rider ' + i}, expected: [201]}), 'register ' + i); }
      catch (e) { if (e.status !== 409) throw e; }
      const session = await withRateLimit(() => request('/auth/login', {body: {phoneNumber, password}}), 'login ' + i);
      riders.push({index: i, phoneNumber, password, refreshToken: session.refreshToken});
      if (riders.length % 250 === 0) { writeJson('riders.json', riders); console.info(`riders ${riders.length}/${count}`); }
    });
  } finally { riders.sort((a, b) => a.index - b.index); writeJson('riders.json', riders); }
  console.info(`riders ${riders.length}/${count}`);
}

// Refresh rotates the refresh token; a rider whose token was lost logs in again with its password.
async function riderTokens() {
  const riders = readJson('riders.json', []);
  if (!riders.length) throw new Error('No riders; run: node deploy/load/accounts.cjs seed');
  let tokens;
  try {
    tokens = await pool(riders, 20, async rider => {
      let session;
      try { session = await request('/auth/refresh', {body: {refreshToken: rider.refreshToken}}); } catch (e) {
        if (e.status !== 401) throw e;
        session = await withRateLimit(() => request('/auth/login', {body: {phoneNumber: rider.phoneNumber, password: rider.password}}), 'login ' + rider.index);
      }
      rider.refreshToken = session.refreshToken;
      return session.accessToken;
    });
  } finally { writeJson('riders.json', riders); }
  writeJson('rider-tokens.json', tokens);
  console.info(`Refreshed ${tokens.length} rider tokens (valid ~15 min)`);
}

// Cancels every active trip of the load riders (frees their drivers). Needs fresh rider-tokens.json.
async function cleanup() {
  const tokens = readJson('rider-tokens.json', []);
  const cancelled = await pool(tokens, 20, async token => {
    const active = await request('/trips/active', {token});
    if (!active?.tripId || !['SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED'].includes(active.status)) return 0;
    await request(`/trips/${active.tripId}/cancel`, {body: {version: active.version, reason: 'load test cleanup'}, token, headers: {'Idempotency-Key': randomUUID()}});
    return 1;
  });
  console.info(`Cancelled ${cancelled.reduce((a, b) => a + b, 0)} active rider trips`);
}

const command = process.argv[2];
(async () => {
  if (command === 'seed') { await seedRiders(options.riders); await seedDrivers(options.drivers); }
  else if (command === 'tokens') await riderTokens();
  else if (command === 'cleanup') await cleanup();
  else if (command === 'sessions') await seedDrivers(options.drivers, true);
  else throw new Error('Usage: node deploy/load/accounts.cjs seed [--drivers N] [--riders N] | tokens | cleanup | sessions [--drivers N]');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
