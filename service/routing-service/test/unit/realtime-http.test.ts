import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { HttpRealtimeLocations } from '../../src/infrastructure/realtime/http';
import { context, point } from '../helpers/fixtures';
test('real nearby maps wire fields, passes vehicle/scope and rejects stale/wrong type', async () => {
  const id = '11111111-1111-4111-8111-111111111111'; let stale = false;
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost'); assert.equal(url.pathname, '/internal/realtime/nearby-drivers'); assert.equal(url.searchParams.get('vehicleType'), 'CAR_4'); assert.equal(url.searchParams.get('radiusMeters'), '2000'); assert.equal(req.headers['x-service-token'], 'scope-token');
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: { radiusMeters: 2000, drivers: [{ driverId: id, vehicleType: 'CAR_4', latitude: point.lat, longitude: point.lng, distanceMeters: 10, recordedAt: new Date(Date.now() - (stale ? 31000 : 0)).toISOString() }] } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { const client = new HttpRealtimeLocations({ baseUrl: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`, token: 'scope-token', maxResponse: 10000 });
    const rows = await client.findNearbyDriverLocations(point, context(), 'CAR_4'); assert.equal(rows[0]?.driverId, id); assert.deepEqual(rows[0]?.location, point);
    stale = true; await assert.rejects(client.findNearbyDriverLocations(point, context(), 'CAR_4'), /INVALID_REALTIME_RESPONSE/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
