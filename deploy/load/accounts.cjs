// Creates and refreshes load-test accounts in the local Kubernetes stack.
//   node deploy/load/accounts.cjs seed --drivers 50 --riders 40
//   node deploy/load/accounts.cjs tokens   (fresh rider access tokens for k6)
//   node deploy/load/accounts.cjs cleanup  (cancel active rider trips)
//   node deploy/load/accounts.cjs sessions --drivers N  (new OTP sessions for drivers 1..N)
//   node deploy/load/accounts.cjs purge    (delete finished load trips and what goes with them, then VACUUM FULL)
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

// Deletes what load runs leave behind: finished trips of the load riders ('Load Rider N') with their status history,
// quotes, outbox rows and request receipts in trip_db; their Matching searches, offers and search-command receipts;
// and the offer-decision receipts of the load drivers (id prefix 30000000-). Open trips, other accounts' data,
// cancel-command receipts and inbox messages (no link to a trip) are kept. Run it with no load running: receipts
// guard against redelivery, and none is pending once the outboxes are drained. Ends with VACUUM FULL ANALYZE.
async function purge() {
  const sql = (db, text) => kubectl(['exec', '-i', 'deploy/postgres', '--', 'sh', '-c', `psql -U "$POSTGRES_USER" -d ${db} -v ON_ERROR_STOP=1 -tA`], text).trim();
  const pending = Number(sql('trip_db', "SELECT count(*) FROM outbox_deliveries WHERE status IN ('pending','processing');")) + Number(sql('matching_db', 'SELECT count(*) FROM matching_outbox WHERE published_at IS NULL;'));
  if (pending) throw new Error(`${pending} outbox messages still pending; wait until no load runs`);
  const riders = sql('user_db', "SELECT id FROM users WHERE full_name LIKE 'Load Rider %';").split('\n').filter(Boolean);
  if (!riders.length) { console.info('No load riders'); return; }
  const values = riders.map(id => `('${id}')`).join(',');
  const trips = sql('trip_db', `BEGIN;
    SET LOCAL session_replication_role = replica;
    CREATE TEMP TABLE lr(id uuid PRIMARY KEY) ON COMMIT DROP; INSERT INTO lr VALUES ${values};
    CREATE TEMP TABLE dt ON COMMIT DROP AS SELECT id FROM trips WHERE rider_id IN (SELECT id FROM lr) AND status IN ('COMPLETED','CANCELLED');
    DELETE FROM outbox_deliveries d USING outbox o, dt WHERE d.outbox_id=o.id AND o.trip_id=dt.id;
    DELETE FROM outbox o USING dt WHERE o.trip_id=dt.id;
    DELETE FROM trip_status_history h USING dt WHERE h.trip_id=dt.id;
    DELETE FROM trip_quotes q WHERE q.rider_id IN (SELECT id FROM lr) AND (q.consumed_trip_id IS NULL OR q.consumed_trip_id IN (SELECT id FROM dt));
    DELETE FROM request_receipts WHERE split_part(scope, ':', 1) = 'RIDER' AND split_part(scope, ':', 2) IN (SELECT id::text FROM lr);
    DELETE FROM request_receipts WHERE scope LIKE 'DRIVER:30000000-0000-4000-8000-%';
    SELECT count(*) FROM dt;
    DELETE FROM trips t USING dt WHERE t.id=dt.id;
    COMMIT;`).split('\n').find(line => /^\d+$/.test(line));
  const searches = sql('matching_db', `BEGIN;
    CREATE TEMP TABLE lr(id text PRIMARY KEY) ON COMMIT DROP; INSERT INTO lr VALUES ${values};
    CREATE TEMP TABLE ds ON COMMIT DROP AS SELECT trip_id, data->'command'->>'commandId' AS command_id FROM matching_searches
      WHERE status IN ('CANCELLED','COMPLETED') AND data->'command'->>'riderId' IN (SELECT id FROM lr);
    DELETE FROM matching_receipts r USING ds WHERE r.scope = 'command:' || ds.command_id;
    DELETE FROM matching_receipts WHERE scope LIKE 'decision:30000000-0000-4000-8000-%';
    DELETE FROM matching_offers o USING ds WHERE o.trip_id=ds.trip_id;
    SELECT count(*) FROM ds;
    DELETE FROM matching_searches s USING ds WHERE s.trip_id=ds.trip_id;
    COMMIT;`).split('\n').find(line => /^\d+$/.test(line));
  console.info(`Deleted ${trips} finished load trips in trip_db and ${searches} searches in matching_db; vacuuming`);
  sql('trip_db', 'VACUUM (FULL, ANALYZE) trips, trip_status_history, trip_quotes, request_receipts, outbox, outbox_deliveries;');
  sql('matching_db', 'VACUUM (FULL, ANALYZE) matching_searches, matching_offers, matching_receipts;');
  console.info(sql('postgres', "SELECT string_agg(datname || '=' || pg_size_pretty(pg_database_size(datname)), ' ') FROM pg_database WHERE datname LIKE '%_db';"));
}

const command = process.argv[2];
(async () => {
  if (command === 'seed') { await seedRiders(options.riders); await seedDrivers(options.drivers); }
  else if (command === 'tokens') await riderTokens();
  else if (command === 'cleanup') await cleanup();
  else if (command === 'sessions') await seedDrivers(options.drivers, true);
  else if (command === 'purge') await purge();
  else throw new Error('Usage: node deploy/load/accounts.cjs seed [--drivers N] [--riders N] | tokens | cleanup | sessions [--drivers N] | purge');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
