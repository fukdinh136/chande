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
