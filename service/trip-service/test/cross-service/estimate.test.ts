import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TripContext } from '../../src/bootstrap/context';
import { loadConfig } from '../../src/bootstrap/config';
import { createApi } from '../../src/api/app';
import { testDatabase, clearDatabase } from '../database';
import { withServer } from '../http-server';
import { rider, driver, assignment } from '../fixtures';
import { quoteResponse, tripResponse } from '../../src/api/schemas';
const moduleAt = (service: string, file: string) => import(pathToFileURL(resolve('..', service, 'dist', file)).href);
const input = { pickup: { lat: 10.77, lng: 106.69 }, destination: { lat: 10.78, lng: 106.7 }, vehicleType: 'CAR' };
async function fixture(run: (f: { request: (path: string, body?: unknown, role?: 'RIDER' | 'DRIVER', headers?: Record<string, string>, method?: string) => Promise<Response>; store: Awaited<ReturnType<typeof testDatabase>>; calls: { service: string; path: string; requestId: string }[] }) => Promise<void>, failure?: 'routing' | 'price-token' | 'timeout') {
  const { loadConfig: routingConfig } = await moduleAt('routing-service', 'bootstrap/config.js');
  const { RoutingRuntime } = await moduleAt('routing-service', 'bootstrap/runtime.js'); const { createApp } = await moduleAt('routing-service', 'api/http.js');
  const { loadConfig: priceConfig } = await moduleAt('price-service', 'bootstrap/config.js'); const { createApi: priceApi } = await moduleAt('price-service', 'api/app.js');
  const routing = await createApp(new RoutingRuntime(routingConfig({ APP_ENV: 'test', ROUTING_TRIP_TOKEN: 'test-routing-token', ROUTING_MATCHING_TOKEN: 'test-matching-token', ROUTING_GATEWAY_TOKEN: 'test-gateway-token', SUPPORTED_VEHICLE_TYPES: 'CAR,BIKE', VEHICLE_PROFILES_FILE: resolve('../routing-service/config/vehicle-profiles.mock.json'), RATE_LIMIT_REQUESTS_PER_SECOND: '1000', RATE_LIMIT_BURST: '100', REQUEST_DEADLINE_MS: failure === 'timeout' ? '30' : '4000' }), undefined, failure === 'routing' || failure === 'timeout' ? { route: async () => { if (failure === 'timeout') return new Promise(() => undefined); throw new Error('fixture-route-failure'); }, matrix: async () => [] } : undefined));
  const price = await priceApi(priceConfig({ PRICE_TRIP_TOKEN: 'test-price-token', FARE_POLICY_FILE: resolve('../price-service/config/fare-policy.example.json') }));
  const calls: { service: string; path: string; requestId: string }[] = [];
  for (const [service, app] of [['routing', routing], ['price', price]] as const) app.getHttpServer().prependListener('request', (req: import('node:http').IncomingMessage) => {
    calls.push({ service, path: req.url ?? '', requestId: String(req.headers['x-request-id'] ?? '') });
  });
  const store = await testDatabase(); await clearDatabase(store);
  try {
    await routing.listen(0, '127.0.0.1'); await price.listen(0, '127.0.0.1');
    const jose = await import('jose'); const { privateKey, publicKey } = await jose.generateKeyPair('RS256'); const jwk = await jose.exportJWK(publicKey);
    await withServer(() => ({ body: { keys: [{ ...jwk, kid: 'cross-service', alg: 'RS256', use: 'sig' }] } }), async jwks => {
      const config = loadConfig({ DATABASE_URL: String(store.db.options.type === 'postgres' ? store.db.options.url : ''), SUPPORTED_VEHICLE_TYPES: 'CAR,BIKE', AUTH_JWKS_URL: jwks + '/jwks', AUTH_JWT_ISSUER: 'cross-service', AUTH_JWT_AUDIENCE: 'trip-service', CURSOR_SIGNING_KEY: 'test-cursor', MATCHING_CALLBACK_TOKEN: 'test-callback', ROUTING_BASE_URL: await routing.getUrl(), PRICING_BASE_URL: await price.getUrl(), ROUTING_TOKEN: 'test-routing-token', PRICING_TOKEN: failure === 'price-token' ? 'wrong-token' : 'test-price-token' });
      const app = await createApi(new TripContext(config, store)); await app.listen(0, '127.0.0.1');
      try {
        await run({ store, calls, request: async (path, body, role = 'RIDER', headers = {}, method) => {
          const principal = role === 'RIDER' ? rider : driver;
          const token = await new jose.SignJWT({ role }).setProtectedHeader({ alg: 'RS256', kid: 'cross-service' }).setSubject(principal.sub).setIssuer('cross-service').setAudience('trip-service').setExpirationTime('5m').sign(privateKey);
          return fetch(await app.getUrl() + path, { method: method ?? (body ? 'POST' : 'GET'), headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
        } });
      } finally { await app.close(); }
    });
  } finally { await Promise.all([routing.close(), price.close(), store.db.destroy()]); }
}
test('Trip HTTP calls Routing then Price for CAR/BIKE, persists quote and freezes fare through completion', async () => fixture(async f => {
  const id = randomUUID(); const response = await f.request('/trips/estimate', input, 'RIDER', { 'X-Request-Id': id }); assert.equal(response.status, 200);
  const envelope = await response.json(); assert.equal(envelope.meta.requestId, id); const quote = quoteResponse.parse(envelope.data);
  assert.deepEqual(f.calls, [{ service: 'routing', path: '/internal/routes/estimate', requestId: id }, { service: 'price', path: '/internal/fares/estimate', requestId: id }]);
  assert.deepEqual(quote.route, { distanceMeters: 4000, durationSeconds: 600 }); assert.equal(quote.fare.amount, '42000'); assert.equal(Date.parse(quote.expiresAt) - Date.parse(quote.createdAt), 300000);
  const bike = await f.request('/trips/estimate', { ...input, vehicleType: 'BIKE' }); assert.equal(bike.status, 200); assert.equal((await bike.json()).data.fare.amount, '20000');
  const key = randomUUID(); const body = { quoteId: quote.quoteId };
  const created = await f.request('/trips', body, 'RIDER', { 'Idempotency-Key': key }); assert.equal(created.status, 201); const trip = tripResponse.parse((await created.json()).data); assert.equal(trip.fare.estimatedAmount, '42000');
  const replay = await f.request('/trips', body, 'RIDER', { 'Idempotency-Key': key }); assert.equal(replay.status, 201); assert.equal(replay.headers.get('Idempotent-Replay'), 'true');
  const assigned = assignment(); assigned.vehicleSnapshot.vehicleType = 'CAR';
  const ack = await f.request(`/internal/trips/${trip.tripId}/assignment`, assigned, 'DRIVER', { 'X-Service-Token': 'test-callback' }); assert.equal(ack.status, 202);
  let version = 2;
  for (const status of ['DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED']) {
    const res = await f.request(`/trips/${trip.tripId}/status`, { status, version: version++ }, 'DRIVER', { 'Idempotency-Key': randomUUID() }, 'PATCH'); assert.equal(res.status, 200);
    const current = tripResponse.parse((await res.json()).data); if (status === 'COMPLETED') assert.equal(current.fare.finalAmount, '42000');
  }
}));
test('Routing errors/timeouts and incorrect Price credential become 503 without persisting quotes', async () => {
  for (const failure of ['routing', 'timeout', 'price-token'] as const) await fixture(async f => {
    const response = await f.request('/trips/estimate', input); assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'DEPENDENCY_UNAVAILABLE');
    const rows: { count: string }[] = await f.store.db.query('SELECT count(*) AS count FROM trip_quotes'); assert.equal(rows[0]?.count, '0');
    if (failure !== 'price-token') assert.equal(f.calls.some(call => call.service === 'price'), false);
  }, failure);
});
