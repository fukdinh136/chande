// k6 consistency test: each rider fires parallel POST /trips and the system must create at most one trip.
//   node deploy/load/accounts.cjs tokens
//   k6 run -e START=2900 -e RIDERS=30 -e PARALLEL=10 deploy/load/dedupe.js
// Cases per rider: A same quote + same Idempotency-Key, B same quote + different keys, C different quotes + different keys.
import http from 'k6/http';
import {SharedArray} from 'k6/data';
import {Counter} from 'k6/metrics';

const BASE = (__ENV.BACKEND_URL || 'http://127.0.0.1:18081').replace(/\/$/, '') + '/api/v1';
const START = Number(__ENV.START || 2900), RIDERS = Number(__ENV.RIDERS || 30), PARALLEL = Number(__ENV.PARALLEL || 10);
const CENTER = {lat: 21.0285, lng: 105.8542};
const tokens = new SharedArray('riders', () => JSON.parse(open('../.local/load/rider-tokens.json')));

export const options = {
  scenarios: {dedupe: {executor: 'per-vu-iterations', vus: RIDERS, iterations: 1, maxDuration: '3m'}},
  thresholds: {duplicate_trips: ['count==0'], unexpected_status: ['count==0']},
};
const duplicates = new Counter('duplicate_trips'), unexpected = new Counter('unexpected_status'), created = new Counter('trips_created');

const headers = (token, extra = {}) => ({'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'X-Request-Id': crypto.randomUUID(), ...extra});
const data = r => { try { return r.json('data'); } catch { return null; } };
const point = () => ({lat: CENTER.lat + (Math.random() - 0.5) / 100, lng: CENTER.lng + (Math.random() - 0.5) / 100});
const quote = token => data(http.post(BASE + '/trips/estimate', JSON.stringify({pickup: point(), destination: {lat: CENTER.lat + 0.02, lng: CENTER.lng + 0.02}, vehicleType: 'CAR_4'}), {headers: headers(token)})).quoteId;

function cancelActive(token) {
  const active = data(http.get(BASE + '/trips/active', {headers: headers(token)}));
  if (active && active.tripId && ['CREATED', 'SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED'].includes(active.status))
    http.post(`${BASE}/trips/${active.tripId}/cancel`, JSON.stringify({version: active.version, reason: 'dedupe test'}), {headers: headers(token, {'Idempotency-Key': crypto.randomUUID()})});
}

// Fires PARALLEL creates at once; returns the distinct trip ids that came back as created/replayed.
function burst(token, name, quoteIds, sameKey) {
  const key = crypto.randomUUID();
  const responses = http.batch(Array.from({length: PARALLEL}, (_, i) => ({method: 'POST', url: BASE + '/trips', body: JSON.stringify({quoteId: quoteIds[i % quoteIds.length]}),
    params: {headers: headers(token, {'Idempotency-Key': sameKey ? key : crypto.randomUUID()}), tags: {name: 'create_' + name}}})));
  const ids = new Set();
  for (const r of responses) {
    if (r.status === 201 || r.status === 200) { const t = data(r); if (t && t.tripId) ids.add(t.tripId); }
    else if (![409, 422].includes(r.status)) unexpected.add(1, {case: name, status: String(r.status)});
  }
  return ids;
}

export default function () {
  const token = tokens[START + __VU - 1];
  cancelActive(token);
  const q1 = quote(token);
  const a = burst(token, 'A', [q1], true);
  if (a.size > 1) duplicates.add(a.size - 1, {case: 'A'}); created.add(a.size);
  const b = burst(token, 'B', [q1], false);
  // Case B reuses the quote of A: nothing new may be created.
  for (const id of b) if (!a.has(id)) duplicates.add(1, {case: 'B'});
  cancelActive(token);
  const c = burst(token, 'C', [quote(token), quote(token)], false);
  if (c.size > 1) duplicates.add(c.size - 1, {case: 'C'}); created.add(c.size);
  cancelActive(token);
}
