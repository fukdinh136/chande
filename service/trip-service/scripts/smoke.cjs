const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const api = process.env.SMOKE_API_URL || 'http://127.0.0.1:3001';
const mocks = process.env.SMOKE_MOCK_URL || 'http://127.0.0.1:3003';
async function request(base, path, body, headers = {}, method) {
  const res = await fetch(base + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
  const value = await res.json(); return { status: res.status, value, headers: res.headers };
}
async function main() {
  assert.equal((await request(api, '/health/ready')).status, 200);
  assert.equal((await request(process.env.SMOKE_WORKER_URL || 'http://127.0.0.1:3002', '/health/ready')).status, 200);
  const riderId = randomUUID(); const driverId = randomUUID();
  const token = async (sub, role) => { const res = await request(mocks, '/mock/token', { sub, role }); assert.equal(res.status, 200); return { Authorization: `Bearer ${res.value.data.accessToken}` }; };
  const rider = await token(riderId, 'RIDER'); const driver = await token(driverId, 'DRIVER');
  const create = async () => {
    const quote = await request(api, '/trips/estimate', { pickup: { lat: 10.77, lng: 106.7 }, destination: { lat: 10.78, lng: 106.69 }, vehicleType: 'MOCK_BIKE' }, rider); assert.equal(quote.status, 200);
    const headers = { ...rider, 'Idempotency-Key': randomUUID() }; const input = { quoteId: quote.value.data.quoteId };
    const first = await request(api, '/trips', input, headers); assert.equal(first.status, 201);
    const replay = await request(api, '/trips', input, headers); assert.equal(replay.headers.get('Idempotent-Replay'), 'true'); assert.deepEqual(replay.value.data, first.value.data);
    assert.equal(first.value.data.fare.estimatedAmount, quote.value.data.fare.amount);
    return first.value.data;
  };
  const trip = await create(); assert.equal(trip.status, 'SEARCHING');
  const assignment = { tripId: trip.tripId, eventId: randomUUID(), driverId, vehicleId: randomUUID(), driverSnapshot: { fullName: 'Smoke Driver', avatarUrl: null }, vehicleSnapshot: { vehicleType: 'MOCK_BIKE', licensePlate: 'SMOKE', brand: null, color: null } };
  let accepted;
  for (let attempt = 0; attempt < 100; attempt++) {
    accepted = await request(mocks, '/mock/accept', assignment);
    if (accepted.status !== 409 || accepted.value.error?.code !== 'TRIP_NOT_SEARCHING') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(accepted.status, 202); let version = 2;
  for (const status of ['DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED']) {
    const res = await request(api, `/trips/${trip.tripId}/status`, { status, version: version++ }, { ...driver, 'Idempotency-Key': randomUUID() }, 'PATCH'); assert.equal(res.status, 200); if (status === 'COMPLETED') assert.equal(res.value.data.fare.finalAmount, trip.fare.estimatedAmount);
  }
  assert.equal((await request(api, '/trips/active', null, rider)).value.data, null);
  const second = await create(); const headers = { ...rider, 'Idempotency-Key': randomUUID() }; const input = { reason: 'Smoke cancellation', version: 1 };
  assert.equal((await request(api, `/trips/${second.tripId}/cancel`, input, headers)).status, 200);
  assert.equal((await request(api, `/trips/${second.tripId}/cancel`, input, headers)).headers.get('Idempotent-Replay'), 'true');
  assert.equal((await request(api, `/internal/trips/${second.tripId}/assignment`, { ...assignment, tripId: undefined, eventId: randomUUID() }, { 'X-Service-Token': 'local-callback' })).status, 409);
  const history = await request(api, '/trips/history', null, rider); assert.equal(history.value.data.items.length, 2);
  console.info(JSON.stringify({ event: 'smoke_passed', completedTripId: trip.tripId, cancelledTripId: second.tripId }));
}
main().catch(error => { console.error('Smoke test failed:', error.message); process.exitCode = 1; });
