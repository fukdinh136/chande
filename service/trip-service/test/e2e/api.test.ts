import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApi } from '../../src/api/app';
import { TripContext } from '../../src/bootstrap/context';
import { loadConfig } from '../../src/bootstrap/config';
import type { Principal, TripData, Quote } from '../../src/domain/models';
import { assignment, rider, driver, quote } from '../fixtures';
import { testDatabase, clearDatabase } from '../database';
import { withServer, envelope } from '../http-server';
import { OutboxDispatcher, HttpDeliverySender } from '../../src/infrastructure/outbox/dispatcher';
import { PgOutbox } from '../../src/infrastructure/outbox/repository';
import { tripResponse, quoteResponse } from '../../src/api/schemas';
type RequestOptions = { method?: string; body?: unknown; principal?: Principal; token?: string; headers?: Record<string, string> };
type HttpResult = { status: number; headers: Headers; body: { data: unknown; error?: { code: string }; meta: { requestId: string } } };
interface Fixture {
 base: string; request: (path: string, options?: RequestOptions) => Promise<HttpResult>; sign: (principal?: Principal, claims?: Record<string, unknown>) => Promise<string>;
 estimate: () => Promise<Quote>; create: () => Promise<TripData>; assign: (id: string, input?: ReturnType<typeof assignment>, token?: string) => Promise<HttpResult>;
 store: Awaited<ReturnType<typeof testDatabase>>; dispatcher: OutboxDispatcher; received: Record<string, unknown>[]; fail: (value: boolean) => void; advance: (ms: number) => void;
}
async function fixture(work: (f: Fixture) => Promise<void>) {
  const jose = await import('jose'); const { privateKey, publicKey } = await jose.generateKeyPair('RS256'); const jwk = await jose.exportJWK(publicKey);
  const store = await testDatabase(); await clearDatabase(store);
  let upstreamFails = false; const received: Record<string, unknown>[] = []; let clock = new Date();
  try { await withServer((req, body) => {
    if (req.url === '/jwks') return { body: { keys: [{ ...jwk, kid: 'test', alg: 'RS256', use: 'sig' }] } };
    assert.equal(req.headers['x-service-token'], 'test-service');
    if (upstreamFails) return { status: 503, body: {} };
    if (req.url === '/internal/routes/estimate') return { body: envelope(quote().route, req.headers['x-request-id']) };
    if (req.url === '/internal/fares/estimate') return { body: envelope(quote().fare, req.headers['x-request-id']) };
    received.push(body); return { status: 202, body: envelope(body.commandId ? { commandId: body.commandId, accepted: true } : { eventId: body.eventId, accepted: true }, req.headers['x-request-id']) };
  }, async url => {
    const config = loadConfig({ DATABASE_URL: store.db.options.type === 'postgres' ? String(store.db.options.url) : '', SUPPORTED_VEHICLE_TYPES: 'MOCK_BIKE', AUTH_JWKS_URL: `${url}/jwks`, AUTH_JWT_ISSUER: 'test-issuer', AUTH_JWT_AUDIENCE: 'trip-test', CURSOR_SIGNING_KEY: 'test-cursor-signing-key', MATCHING_CALLBACK_TOKEN: 'test-callback', ROUTING_BASE_URL: url, PRICING_BASE_URL: url, ROUTING_TOKEN: 'test-service', PRICING_TOKEN: 'test-service', SWAGGER_ENABLED: 'true' });
    Object.assign(config, { matchingUrl: url, gatewayUrl: url, notificationUrl: url, matchingToken: 'test-service', gatewayToken: 'test-service', notificationToken: 'test-service' });
    const context = new TripContext(config, store, { now: () => clock, id: randomUUID }); const app = await createApi(context); await app.listen(0, '127.0.0.1');
    const sign = (principal: Principal = rider, claims: Record<string, unknown> = {}) => new jose.SignJWT({ role: principal.role, ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(principal.sub).setIssuer('test-issuer').setAudience('trip-test').setExpirationTime('10m').sign(privateKey);
    async function setup() {
      const base = await app.getUrl();
      const request = async (path: string, options: { method?: string; body?: unknown; principal?: Principal; token?: string; headers?: Record<string, string> } = {}) => {
        const token = options.token ?? await sign(options.principal);
        const response = await fetch(base + path, { method: options.method ?? (options.body ? 'POST' : 'GET'), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
        const body = await response.json() as { data: unknown; error?: { code: string }; meta: { requestId: string } };
        return { status: response.status, headers: response.headers, body };
      };
      const estimate = async () => { const { pickup, destination, vehicleType } = quote(); const response = await request('/trips/estimate', { body: { pickup, destination, vehicleType } }); assert.equal(response.status, 200); quoteResponse.parse(response.body.data); return response.body.data as Quote; };
      const create = async () => { const q = await estimate(); const response = await request('/trips', { body: { quoteId: q.quoteId }, headers: { 'Idempotency-Key': randomUUID() } }); assert.equal(response.status, 201); tripResponse.parse(response.body.data); return response.body.data as TripData; };
      const assign = (id: string, input = assignment(), token = 'test-callback') => request(`/internal/trips/${id}/assignment`, { body: input, headers: { 'X-Service-Token': token } });
      const dispatcher = new OutboxDispatcher(new PgOutbox(store.db), new HttpDeliverySender(config), config);
      return { base, request, sign, estimate, create, assign, store, dispatcher, received, fail: (value: boolean) => { upstreamFails = value; }, advance: (ms: number) => { clock = new Date(+clock + ms); } };
    }
    try { await work(await setup()); } finally { await app.close(); }
  }); } finally { await store.db.destroy(); }

}
test('HTTP journey authenticates JWT, assigns asynchronously and completes at locked fare', async () => fixture(async f => {
  const trip = await f.create(); assert.equal(trip.status, 'SEARCHING'); assert.equal(f.received.length, 0);
  await f.dispatcher.tick(); assert.ok(f.received.some(message => message.commandId));
  assert.equal((await f.assign(trip.tripId)).status, 202);
  const outsider = { ...driver, sub: randomUUID() }; assert.equal((await f.request(`/trips/${trip.tripId}`, { principal: outsider })).status, 404);
  let version = 2;
  for (const status of ['DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED']) {
    const response = await f.request(`/trips/${trip.tripId}/status`, { method: 'PATCH', principal: driver, body: { status, version: version++ }, headers: { 'Idempotency-Key': randomUUID() } }); assert.equal(response.status, 200); tripResponse.parse(response.body.data);
  }
  const detail = await f.request(`/trips/${trip.tripId}`); const data = detail.body.data as { trip: TripData; statusHistory: unknown[] }; assert.equal(data.trip.fare.finalAmount, '45000'); assert.equal(data.statusHistory.length, 6);
  assert.equal((await f.request('/trips/active')).body.data, null); assert.equal((await f.request('/trips/history')).status, 200);
  await f.dispatcher.tick(); assert.ok(f.received.some(message => message.type === 'trip.completed'));
}));
test('HTTP rejects expired quotes, cancels once and rejects late assignment', async () => fixture(async f => {
  const expired = await f.estimate(); f.advance(300000);
  const create = await f.request('/trips', { body: { quoteId: expired.quoteId }, headers: { 'Idempotency-Key': randomUUID() } }); assert.equal(create.body.error?.code, 'QUOTE_EXPIRED');
  const trip = await f.create(); const key = randomUUID(); const body = { reason: 'stop', version: 1 };
  const first = await f.request(`/trips/${trip.tripId}/cancel`, { body, headers: { 'Idempotency-Key': key } }); assert.equal(first.status, 200);
  const replay = await f.request(`/trips/${trip.tripId}/cancel`, { body, headers: { 'Idempotency-Key': key } }); assert.equal(replay.headers.get('Idempotent-Replay'), 'true'); assert.deepEqual(first.body.data, replay.body.data);
  assert.equal((await f.assign(trip.tripId)).body.error?.code, 'TRIP_NOT_SEARCHING');
  await f.dispatcher.tick(); assert.ok(!f.received.some(message => message.type === 'matching.search.requested')); assert.equal((await f.store.transaction(tx => tx.history(trip.tripId))).length, 3);
}));
test('HTTP protects identity, validates strict DTO and publishes request/response OpenAPI', async () => fixture(async f => {
  assert.equal((await f.request('/trips/active', { token: 'invalid' })).status, 401);
  assert.equal((await f.request('/trips/active', { token: await f.sign(rider, { role: 'ADMIN' }) })).status, 401);
  assert.equal((await f.request('/trips/active', { headers: { 'X-Request-Id': 'wrong' } })).status, 400);
  const q = await f.estimate();
  assert.equal((await f.request('/trips', { body: { quoteId: q.quoteId, riderId: randomUUID() }, headers: { 'Idempotency-Key': randomUUID() } })).status, 400);
  assert.equal((await f.request('/trips/history?limit=101')).status, 400);
  assert.equal((await f.assign(randomUUID(), assignment(), 'wrong')).status, 401);
  f.fail(true); assert.equal((await f.request('/trips/estimate', { body: { pickup: q.pickup, destination: q.destination, vehicleType: q.vehicleType } })).status, 503);
  const count: { count: string }[] = await f.store.db.query('SELECT count(*) FROM trip_quotes'); assert.equal(count[0]?.count, '1');
  const schema = await (await fetch(f.base + '/openapi.json')).json() as { paths: Record<string, { post?: { requestBody: unknown; responses: Record<string, { content: unknown }> } }> };
  assert.ok(schema.paths['/trips']?.post?.requestBody); assert.ok(schema.paths['/trips']?.post?.responses['201']?.content); assert.ok(schema.paths['/trips/active']); assert.ok(schema.paths['/internal/trips/{id}/assignment']);
  assert.equal((await f.request('/health/ready')).status, 200);
}));
test('HTTP concurrent retries commit one Trip and enforce active rider constraint', async () => fixture(async f => {
  const q = await f.estimate(); const key = randomUUID(); const options = { body: { quoteId: q.quoteId }, headers: { 'Idempotency-Key': key } };
  const [a, b] = await Promise.all([f.request('/trips', options), f.request('/trips', options)]); assert.equal(a.status, 201); assert.equal(b.status, 201); assert.deepEqual(a.body.data, b.body.data);
  const second = await f.estimate(); assert.equal((await f.request('/trips', { body: { quoteId: second.quoteId }, headers: { 'Idempotency-Key': randomUUID() } })).body.error?.code, 'ACTIVE_TRIP_EXISTS');
  const trip = a.body.data as TripData;
  const results = await Promise.all([f.assign(trip.tripId), f.assign(trip.tripId, { ...assignment(), eventId: randomUUID(), driverId: randomUUID() })]);
  assert.deepEqual(results.map(r => r.status).sort(), [202, 409]);
}));
