// k6 rider flow: quote -> create trip -> wait for ASSIGNED -> cancel (frees the simulated driver).
// EVENTS=poll (default) polls GET /trips/:id every POLL_MS. EVENTS=ws waits like the app: a Gateway /ws session
// receives trip.assigned, then one GET /trips/:id reads the details (E2).
//   node deploy/load/accounts.cjs tokens
//   k6 run -e RATE=1 -e DURATION=5m deploy/load/booking.js
// Each VU owns one rider account, so a rider never has two active trips.
import http from 'k6/http';
import ws from 'k6/ws';
import {sleep} from 'k6';
import {SharedArray} from 'k6/data';
import {Counter, Trend} from 'k6/metrics';
import exec from 'k6/execution';

const BASE = (__ENV.BACKEND_URL || 'http://127.0.0.1:18081').replace(/\/$/, '') + '/api/v1';
const RATE = Number(__ENV.RATE || 1), DURATION = __ENV.DURATION || '5m';
// TRIPS=N switches to burst mode: N riders each book once (quote + create) and keep the trip.
// Assignment is then measured from the database, so k6 does not poll or cancel.
const TRIPS = Number(__ENV.TRIPS || 0);
const ASSIGN_TIMEOUT_MS = Number(__ENV.ASSIGN_TIMEOUT_MS || 60000), POLL_MS = Number(__ENV.POLL_MS || 300);
const CENTER = {lat: 21.0285, lng: 105.8542};
const EVENTS = __ENV.EVENTS || 'poll';
const WS_URL = BASE.replace(/^http/, 'ws').replace(/\/api\/v1$/, '') + '/ws';
const tokens = new SharedArray('riders', () => JSON.parse(open('../.local/load/rider-tokens.json')));
// LOGIN=1 (long runs): each VU logs its rider in and renews the access token every 10 minutes (tokens last 15).
const LOGIN = __ENV.LOGIN === '1';
const credentials = LOGIN ? new SharedArray('credentials', () => JSON.parse(open('../.local/load/riders.json')).map(r => [r.phoneNumber, r.password])) : [];
let session = null;
function riderToken() {
  if (!LOGIN) return tokens[(__VU - 1) % tokens.length];
  if (!session || Date.now() - session.at > 600000) {
    const [phoneNumber, password] = credentials[(__VU - 1) % credentials.length];
    const r = http.post(BASE + '/auth/login', JSON.stringify({phoneNumber, password}), {headers: {'Content-Type': 'application/json'}, tags: {name: 'login'}});
    const body = (() => { try { return r.json(); } catch { return null; } })();
    session = {token: (body && (body.data || body).accessToken) || '', at: Date.now()};
  }
  return session.token;
}

export const options = {
  // k6 needs an integer rate, so fractional rates are expressed per minute.
  scenarios: {booking: TRIPS
    ? {executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', duration: Math.ceil(TRIPS / RATE) + 's', preAllocatedVUs: 100, maxVUs: 1000}
    : {executor: 'constant-arrival-rate', ...(Number.isInteger(RATE) ? {rate: RATE, timeUnit: '1s'} : {rate: Math.round(RATE * 60), timeUnit: '1m'}), duration: DURATION, preAllocatedVUs: Math.min(300, tokens.length), maxVUs: tokens.length}},
  // Loose limits: they only make k6 report each step separately, the baseline is not a pass/fail gate.
  thresholds: {http_req_failed: ['rate<0.05'], ...Object.fromEntries(['quote', 'create', 'poll', 'read', 'cancel'].map(n => [`http_req_duration{name:${n}}`, ['p(95)<60000']]))},
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const timeToAssigned = new Trend('time_to_assigned', true);
const createdTrips = new Counter('trips_created');
const assigned = new Counter('trips_assigned'), notAssigned = new Counter('trips_not_assigned'), failed = new Counter('trips_failed');
const wsFailed = new Counter('ws_failed');

function around(origin, meters, min = 0) {
  const d = min + Math.sqrt(Math.random()) * (meters - min), a = Math.random() * 2 * Math.PI;
  return {lat: origin.lat + d * Math.cos(a) / 111320, lng: origin.lng + d * Math.sin(a) / (111320 * Math.cos(origin.lat * Math.PI / 180))};
}

function call(method, path, token, body, name, extra = {}) {
  const headers = {'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'X-Request-Id': crypto.randomUUID(), ...extra};
  return http.request(method, BASE + path, body === undefined ? null : JSON.stringify(body), {headers, tags: {name}});
}
const data = r => { try { return r.json('data'); } catch { return null; } };

function cancel(token, trip, name) {
  call('POST', `/trips/${trip.tripId}/cancel`, token, {version: trip.version, reason: 'load test'}, name, {'Idempotency-Key': crypto.randomUUID()});
}

// Cancel trips left active by an aborted earlier run.
export function setup() {
  if (TRIPS || __ENV.SKIP_SETUP) return; // run.cjs cleans up burst riders with accounts.cjs cleanup
  for (const token of tokens) {
    const active = data(call('GET', '/trips/active', token, undefined, 'setup_active'));
    if (active && active.tripId) cancel(token, active, 'setup_cancel');
  }
}

// Quote and create one trip; returns the created trip or null (failure already counted).
function book(token) {
  const pickup = around(CENTER, 1500), destination = around(pickup, 4000, 1000);
  const quote = call('POST', '/trips/estimate', token, {pickup, destination, vehicleType: 'CAR_4'}, 'quote');
  if (quote.status !== 200) { failed.add(1, {step: 'quote'}); return null; }
  const created = call('POST', '/trips', token, {quoteId: data(quote).quoteId}, 'create', {'Idempotency-Key': crypto.randomUUID()});
  if (created.status !== 201) { failed.add(1, {step: 'create'}); return null; }
  return data(created);
}

function finish(token, trip, createdAt, assignedAt) {
  if (assignedAt) { timeToAssigned.add(assignedAt - createdAt); assigned.add(1); }
  else notAssigned.add(1, {status: trip.status});
  if (['SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED'].includes(trip.status)) cancel(token, trip, 'cancel');
}

// Like the app: one /ws session per rider; trip.assigned for this trip ends the wait, then one REST read.
function viaEvents(token) {
  let trip = null, createdAt = 0, assignedAt = 0;
  const res = ws.connect(WS_URL, {tags: {name: 'ws'}}, socket => {
    socket.on('open', () => socket.send(JSON.stringify({type: 'auth', token})));
    socket.on('message', raw => {
      let message; try { message = JSON.parse(raw); } catch { return; }
      if (message.type === 'auth.ok' && !trip) {
        trip = book(token); createdAt = Date.now();
        if (!trip) { socket.close(); return; }
        socket.setInterval(() => socket.send(JSON.stringify({type: 'ping'})), 25000);
        socket.setTimeout(() => socket.close(), ASSIGN_TIMEOUT_MS);
      } else if (message.type === 'trip.event' && trip && message.event && message.event.tripId === trip.tripId && message.event.type === 'trip.assigned') {
        assignedAt = Date.now();
        const body = data(call('GET', '/trips/' + trip.tripId, token, undefined, 'read'));
        if (body && body.trip) trip = body.trip; else trip.status = 'ASSIGNED';
        socket.close();
      }
    });
    socket.setTimeout(() => socket.close(), ASSIGN_TIMEOUT_MS + 15000);
  });
  if (!res || res.status !== 101) { wsFailed.add(1); failed.add(1, {step: 'ws'}); return; }
  if (!trip) return;
  if (!assignedAt) { const body = data(call('GET', '/trips/' + trip.tripId, token, undefined, 'read')); if (body && body.trip) trip = body.trip; }
  finish(token, trip, createdAt, assignedAt);
}

export default function () {
  if (TRIPS) return burst();
  const token = riderToken();
  if (EVENTS === 'ws') return viaEvents(token);
  const created = book(token);
  if (!created) return;
  const createdAt = Date.now();
  let trip = created;
  while (Date.now() - createdAt < ASSIGN_TIMEOUT_MS) {
    sleep(POLL_MS / 1000);
    const r = call('GET', '/trips/' + trip.tripId, token, undefined, 'poll');
    const body = data(r);
    if (r.status === 200 && body && body.trip) trip = body.trip;
    if (trip.status !== 'SEARCHING') break;
  }
  finish(token, trip, createdAt, trip.status === 'ASSIGNED' ? Date.now() : 0);
}

function burst() {
  const index = exec.scenario.iterationInTest;
  if (index >= TRIPS || index >= tokens.length) return;
  const token = tokens[index];
  const pickup = around(CENTER, 1500), destination = around(pickup, 4000, 1000);
  const quote = call('POST', '/trips/estimate', token, {pickup, destination, vehicleType: 'CAR_4'}, 'quote');
  if (quote.status !== 200) { failed.add(1, {step: 'quote'}); return; }
  const created = call('POST', '/trips', token, {quoteId: data(quote).quoteId}, 'create', {'Idempotency-Key': crypto.randomUUID()});
  if (created.status !== 201) { failed.add(1, {step: 'create', status: String(created.status)}); return; }
  createdTrips.add(1);
}

export function handleSummary(summary) {
  const m = summary.metrics, ms = name => m[name] ? m[name].values : null;
  const lines = ['', 'BOOKING SUMMARY',
    `trips created=${m.trips_created ? m.trips_created.values.count : 0} assigned=${m.trips_assigned ? m.trips_assigned.values.count : 0} notAssigned=${m.trips_not_assigned ? m.trips_not_assigned.values.count : 0} failed=${m.trips_failed ? m.trips_failed.values.count : 0}`,
    `http_req_failed=${(m.http_req_failed.values.rate * 100).toFixed(2)}% requests=${m.http_reqs.values.count} dropped_iterations=${m.dropped_iterations ? m.dropped_iterations.values.count : 0}`];
  for (const name of ['time_to_assigned', 'http_req_duration{name:quote}', 'http_req_duration{name:create}', 'http_req_duration{name:poll}', 'http_req_duration{name:read}', 'http_req_duration{name:cancel}']) {
    const v = ms(name);
    if (v) lines.push(`${name.padEnd(32)} p50=${v.med.toFixed(0)}ms p95=${v['p(95)'].toFixed(0)}ms p99=${v['p(99)'].toFixed(0)}ms max=${v.max.toFixed(0)}ms`);
  }
  const out = {stdout: lines.join('\n') + '\n'};
  if (__ENV.SUMMARY_OUT) out[__ENV.SUMMARY_OUT] = JSON.stringify(summary, null, 2);
  return out;
}
