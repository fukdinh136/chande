const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const osrm = process.env.OSRM_SMOKE_URL || 'http://127.0.0.1:5000';
const routing = process.env.ROUTING_SMOKE_URL || 'http://127.0.0.1:3004';
const trip = process.env.TRIP_SMOKE_URL || 'http://127.0.0.1:3001';
const tokens = { trip: process.env.ROUTING_TRIP_TOKEN || 'local-routing', gateway: process.env.ROUTING_GATEWAY_TOKEN || 'local-routing-gateway', matching: process.env.ROUTING_MATCHING_TOKEN || 'local-routing-matching' };
const pickup = { lat: 21.0285, lng: 105.8542 }; const destination = { lat: 21.0272, lng: 105.8355 };
const coordinates = points => points.map(p => `${p.lng},${p.lat}`).join(';');
const wait = () => new Promise(resolve => setTimeout(resolve, 550)); // Respect local 2 req/s limiter.
async function raw(path) {
  const response = await fetch(osrm + path, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.code, 'Ok'); return body;
}
async function post(path, caller, body) {
  const id = randomUUID();
  const response = await fetch(routing + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': tokens[caller], 'x-request-id': id }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200); const envelope = await response.json(); assert.equal(envelope.meta.requestId, id); return envelope.data;
}
async function main() {
  const direct = (await raw('/route/v1/driving/' + coordinates([pickup, destination]) + '?overview=false')).routes[0];
  assert.ok(direct.distance > 1000 && direct.duration > 0);
  const expected = { distanceMeters: Math.ceil(direct.distance), durationSeconds: Math.ceil(direct.duration) };
  const estimate = await post('/internal/routes/estimate', 'trip', { pickup, destination, vehicleType: 'CAR' });
  assert.deepEqual(estimate, expected); await wait();
  const full = await post('/routes', 'gateway', { origin: pickup, destination, vehicleType: 'CAR', includeSteps: true });
  assert.ok(full.polyline.value && full.steps.length); assert.equal(full.distanceMeters, expected.distanceMeters); await wait();
  const currentLocation = { lat: 21.03, lng: 105.85 };
  const rerouteDirect = (await raw('/route/v1/driving/' + coordinates([currentLocation, destination]) + '?overview=false')).routes[0];
  const reroute = await post('/routes/recalculate', 'gateway', { currentLocation, destination, vehicleType: 'CAR' });
  assert.equal(reroute.distanceMeters, Math.ceil(rerouteDirect.distance)); await wait();
  const matrix = await post('/routes/matrix', 'matching', { pickup, vehicleType: 'CAR' });
  assert.equal(matrix.entries.length, 2); assert.deepEqual(matrix.entries.map(entry => entry.driverId), ['mock-driver-a', 'mock-driver-b']);
  const table = await raw('/table/v1/driving/' + coordinates([...matrix.entries.map(entry => entry.location), pickup]) + '?sources=0;1&destinations=2&annotations=duration,distance');
  matrix.entries.forEach((entry, i) => { assert.equal(entry.status, 'OK'); assert.equal(entry.distanceMeters, Math.ceil(table.distances[i][0])); assert.equal(entry.durationSeconds, Math.ceil(table.durations[i][0])); }); await wait();
  const unsupported = await fetch(routing + '/internal/routes/estimate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': tokens.trip }, body: JSON.stringify({ pickup, destination, vehicleType: 'BIKE' }) });
  assert.equal(unsupported.status, 400);
  const tokenResponse = await fetch((process.env.TRIP_MOCK_URL || 'http://127.0.0.1:3003') + '/mock/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: randomUUID(), role: 'RIDER' }) });
  assert.equal(tokenResponse.status, 200); const token = (await tokenResponse.json()).data.accessToken;
  const quoteResponse = await fetch(trip + '/trips/estimate', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ pickup, destination, vehicleType: 'CAR' }), signal: AbortSignal.timeout(6000) });
  assert.equal(quoteResponse.status, 200); const quote = (await quoteResponse.json()).data; assert.deepEqual(quote.route, expected);
  const policy = JSON.parse(readFileSync(resolve(__dirname, '../../price-service/config/fare-policy.example.json'), 'utf8')).vehicleTypes.CAR;
  const amount = BigInt(policy.openingFareVnd) + (BigInt(Math.max(0, expected.distanceMeters - policy.includedDistanceMeters)) * BigInt(policy.pricePerKmVnd) + 999n) / 1000n;
  assert.equal(quote.fare.amount, String(amount));
  console.info(JSON.stringify({ event: 'osrm_smoke_passed', region: 'hanoi', vehicleType: 'CAR', ...expected, amount: String(amount), matrixEntries: matrix.entries.length, realtime: 'mock' }));
}
main().catch(error => { console.error('OSRM smoke failed:', error.message); process.exitCode = 1; });
