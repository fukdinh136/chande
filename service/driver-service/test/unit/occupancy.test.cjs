const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HttpOccupancy } = require('../../src/infrastructure/clients/occupancy.client');
test('availability lookup combines active Trip and reservation; dependency failure never returns free', async () => {
  const { createServer } = require('node:http');
  const id = '11111111-1111-4111-8111-111111111111'; let fail = false;
  const server = createServer((req, res) => { if (fail) { res.writeHead(503); res.end(); return; } res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ data: { items: [{ driverId: id, tripId: req.url.includes('reservations') ? id : null }] } })); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { const url = `http://127.0.0.1:${server.address().port}`, client = new HttpOccupancy(url, 'trip-token', url, 'matching-token', 1000); assert.equal((await client.lookup([id])).get(id), true); fail = true; await assert.rejects(client.lookup([id]), /DEPENDENCY_UNAVAILABLE/); } finally { await new Promise(r => server.close(r)); }
});
test('availability lookup stops calling a failing Trip and Matching until the breaker lets a trial through', async () => {
  const { createServer } = require('node:http');
  const id = '11111111-1111-4111-8111-111111111111'; let hits = 0, fail = true;
  const server = createServer((req, res) => { hits++; if (fail) { res.writeHead(500); res.end(); return; } res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ data: { items: [{ driverId: id, tripId: null }] } })); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const clock = { t: 0 };
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const client = new HttpOccupancy(url, 'trip-token', url, 'matching-token', 1000, { failureThreshold: 2, openMs: 5000, now: () => clock.t, onChange: () => {} });
    const settled = () => new Promise(r => setTimeout(r, 50)); // Promise.all rejects on the first failure; let the other call finish
    for (let i = 0; i < 2; i++) { await assert.rejects(client.lookup([id]), /DEPENDENCY_UNAVAILABLE/); await settled(); }
    assert.equal(client.breakers.trip.state, 'open'); assert.equal(client.breakers.matching.state, 'open'); assert.equal(hits, 4);
    await assert.rejects(client.lookup([id]), /DEPENDENCY_UNAVAILABLE/);
    assert.equal(hits, 4, 'open breakers fail at once without calling Trip or Matching');
    clock.t += 5000; fail = false;
    assert.equal((await client.lookup([id])).get(id), false);
    assert.equal(client.breakers.trip.state, 'closed'); assert.equal(hits, 6);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
test('active trip check counts 401 and 403 as answers and fails at once while Trip is down', async () => {
  const { createServer } = require('node:http');
  const { HttpTripActive } = require('../../src/infrastructure/clients/trip-active.client');
  const { CircuitBreaker } = require('../../src/infrastructure/circuit-breaker');
  let hits = 0, status = 401;
  const server = createServer((req, res) => { hits++; res.writeHead(status); res.end(); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const client = new HttpTripActive(`http://127.0.0.1:${server.address().port}`, 1000, new CircuitBreaker('trip', { failureThreshold: 2, openMs: 60000, onChange: () => {} }));
    for (let i = 0; i < 3; i++) await assert.rejects(client.active('Bearer x'), /UNAUTHENTICATED/);
    assert.equal(client.breaker.state, 'closed');
    status = 503;
    for (let i = 0; i < 2; i++) await assert.rejects(client.active('Bearer x'), /DEPENDENCY_UNAVAILABLE/);
    await assert.rejects(client.active('Bearer x'), /DEPENDENCY_UNAVAILABLE/);
    assert.equal(hits, 5, 'the third 503 never reached Trip');
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
