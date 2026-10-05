import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../../src/bootstrap/config';
import { OsrmProvider } from '../../src/infrastructure/map/osrm';
import { encodePolyline, decodePolyline } from '../../src/infrastructure/map/polyline';
import { systemClock, type Context } from '../../src/application/ports/clients';
const origin = { lat: 10.77, lng: 106.69 }; const destination = { lat: 10.78, lng: 106.70 };
const context = (): Context => ({ requestId: '90000000-0000-4000-8000-000000000001', deadline: performance.now() + 2000, signal: new AbortController().signal });
async function fixture(handler: (url: URL, res: ServerResponse) => void, run: (p: OsrmProvider) => Promise<void>, overrides: NodeJS.ProcessEnv = {}) {
  const server = createServer((req, res) => handler(new URL(req.url!, 'http://localhost'), res));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const config = loadConfig({ APP_ENV: 'test', ROUTING_TRIP_TOKEN: 'trip', ROUTING_MATCHING_TOKEN: 'matching', ROUTING_GATEWAY_TOKEN: 'gateway', INTEGRATION_MODE: 'real', SUPPORTED_VEHICLE_TYPES: 'CAR', EXTERNAL_MAP_ALLOW_HTTP: 'true', EXTERNAL_MAP_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, ...overrides }, { read: () => JSON.stringify({ schemaVersion: 1, vehicleTypes: { CAR: { profile: 'driving', baseUrl: null } } }) });
  try { await run(new OsrmProvider(config, systemClock)); } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}
test('OSRM summary wire preserves lng/lat direction and rounds measurements', async () => {
  await fixture((url, res) => {
    assert.equal(url.pathname, '/route/v1/driving/106.69,10.77;106.7,10.78'); assert.equal(url.searchParams.get('overview'), 'false'); assert.equal(url.searchParams.get('steps'), 'false');
    res.end(JSON.stringify({ code: 'Ok', routes: [{ distance: 10.1, duration: 2.1 }] }));
  }, async p => assert.deepEqual(await p.route({ origin, destination, vehicleType: 'CAR', full: false, includeSteps: false }, context()), { distanceMeters: 11, durationSeconds: 3, steps: [] }));
});
test('OSRM full route decodes polyline6 and maps steps without invented instruction', async () => {
  await fixture((url, res) => {
    assert.equal(url.searchParams.get('geometries'), 'polyline6'); assert.equal(url.searchParams.get('steps'), 'true');
    res.end(JSON.stringify({ code: 'Ok', routes: [{ distance: 10, duration: 2, geometry: encodePolyline([origin, destination]), legs: [{ steps: [{ distance: 10, duration: 2, name: 'Street', maneuver: { type: 'depart', location: [origin.lng, origin.lat] } }] }] }] }));
  }, async p => {
    const result = await p.route({ origin, destination, vehicleType: 'CAR', full: true, includeSteps: true }, context());
    assert.deepEqual(decodePolyline(result.polyline!.value), [origin, destination]); assert.equal(result.steps[0]!.instruction, null); assert.deepEqual(result.steps[0]!.maneuver.location, origin);
  });
});
test('OSRM Table sources are drivers, destination is pickup; nulls are NO_ROUTE', async () => {
  await fixture((url, res) => {
    assert.equal(url.pathname, '/table/v1/driving/106.69,10.77;106.7,10.78;106.69,10.77'); assert.equal(url.searchParams.get('sources'), '0;1'); assert.equal(url.searchParams.get('destinations'), '2'); assert.equal(url.searchParams.has('fallback_speed'), false);
    res.end(JSON.stringify({ code: 'Ok', distances: [[10.1], [null]], durations: [[2], [null]] }));
  }, async p => assert.deepEqual(await p.matrix({ origins: [origin, destination], destination: origin, vehicleType: 'CAR' }, context()), [{ status: 'OK', distanceMeters: 11, durationSeconds: 2 }, { status: 'NO_ROUTE', distanceMeters: null, durationSeconds: null }]));
});
test('OSRM codes and HTTP status produce sanitized errors, not success', async () => {
  for (const [status, code, expected] of [[200, 'NoRoute', 'NO_ROUTE'], [400, 'TooBig', 'PROVIDER_CONFIGURATION_ERROR'], [200, 'NotImplemented', 'UNSUPPORTED_CAPABILITY'], [200, 'Unknown', 'INVALID_PROVIDER_RESPONSE'], [401, 'secret', 'PROVIDER_CONFIGURATION_ERROR'], [429, 'secret', 'PROVIDER_UNAVAILABLE']] as const) {
    await fixture((_, res) => { res.statusCode = status; res.end(JSON.stringify({ code, message: 'sensitive' })); }, async p => { await assert.rejects(p.route({ origin, destination, vehicleType: 'CAR', full: false, includeSteps: false }, context()), (e: unknown) => e instanceof Error && e.message === expected); });
  }
});
test('malformed, oversized bodies, invalid geometry and matrix shapes fail closed', async () => {
  for (const body of ['{bad', JSON.stringify({ code: 'Ok', routes: [{ distance: -1, duration: 2 }] }), 'x'.repeat(101)]) {
    await fixture((_, res) => res.end(body), async p => { await assert.rejects(p.route({ origin, destination, vehicleType: 'CAR', full: false, includeSteps: false }, context()), /INVALID_PROVIDER_RESPONSE/); }, { UPSTREAM_MAX_RESPONSE_BYTES: '100' });
  }
  assert.throws(() => decodePolyline('a'), /INVALID_PROVIDER_RESPONSE/);
  await fixture((_, res) => res.end(JSON.stringify({ code: 'Ok', distances: [[null]], durations: [[1]] })), async p => { await assert.rejects(p.matrix({ origins: [origin], destination, vehicleType: 'CAR' }, context()), /INVALID_PROVIDER_RESPONSE/); });
});
test('redirects are not followed and aborted requests do not survive deadline', async () => {
  await fixture((_, res) => { res.writeHead(302, { location: 'http://localhost/private' }); res.end(); }, async p => { await assert.rejects(p.route({ origin, destination, vehicleType: 'CAR', full: false, includeSteps: false }, context()), /PROVIDER_UNAVAILABLE/); });
  await fixture(() => undefined, async p => {
    const ctx = context(); const controller = new AbortController(); const promise = p.route({ origin, destination, vehicleType: 'CAR', full: false, includeSteps: false }, { ...ctx, signal: controller.signal }); controller.abort();
    await assert.rejects(promise, /ROUTING_DEADLINE_EXCEEDED/);
  });
});
