import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { matchingGrpc } from '../src/api/grpc';
import type { Context } from '../src/api/app';
import { CircuitBreaker } from '../src/infrastructure/circuit-breaker';
import { CallError, GrpcClient, GrpcServer, header, loadService, type Failure, type Handler, type UnaryCall } from '../src/infrastructure/grpc';
import { GrpcClients } from '../src/infrastructure/grpc-clients';
import { UpstreamError } from '../src/infrastructure/clients';
import { describeFailure } from '../src/application/retry';
import type { Config } from '../src/bootstrap/config';

const quiet = { onChange: () => {} };
const matchingService = () => loadService('matching.proto', 'chande.matching.v1.MatchingInternal');
const client = (port: number, breaker = new CircuitBreaker('matching', quiet)) => new GrpcClient(matchingService(), `127.0.0.1:${port}`, 2000, breaker);
const search = () => ({ commandId: randomUUID(), type: 'matching.search.requested', tripId: randomUUID(), tripVersion: 2, occurredAt: new Date().toISOString(), riderId: randomUUID(), pickup: { lat: 21.03, lng: 105.85, address: 'A' }, destination: { lat: 21.04, lng: 105.86 }, vehicleType: 'CAR_4', route: { distanceMeters: 0, durationSeconds: 600 }, fare: { currency: 'VND', amount: '45000' } });

async function matching() {
  const calls: { kind: string; input: unknown }[] = [];
  const ctx = {
    config: { tokens: { trip: 'trip-token', driver: 'driver-token', realtime: 'realtime-token' } },
    commands: { search: async (c: { commandId: string }) => { calls.push({ kind: 'search', input: c }); return { commandId: c.commandId, accepted: true }; },
      stop: async (id: string, _trip: string, input: unknown, status: string) => { calls.push({ kind: status, input }); return status === 'COMPLETED' ? { eventId: id, accepted: true } : { commandId: id, accepted: true }; } },
    repo: { reservations: async (ids: string[]) => ids.map((driverId, i) => ({ driverId, tripId: i === 0 ? driverId : null })), getOffer: async () => null, activeOffer: async () => null },
  } as unknown as Context;
  const server = matchingGrpc(ctx); const port = await server.listen('127.0.0.1', 0);
  return { server, port, calls };
}

test('Matching serves its internal API over gRPC with the same tokens, schemas and errors as HTTP', async () => {
  const { server, port, calls } = await matching(); const c = client(port);
  try {
    const cmd = search();
    assert.deepEqual(await c.call('StartSearch', cmd, { 'x-service-token': 'trip-token' }), { commandId: cmd.commandId, accepted: true });
    assert.deepEqual(calls[0]!.input, cmd, 'the command reaches the use case exactly as over HTTP, route distance 0 included');
    await assert.rejects(c.call('StartSearch', cmd, { 'x-service-token': 'driver-token' }), (e: CallError) => e.status === 401 && e.code === 'UNAUTHENTICATED');
    await assert.rejects(c.call('StartSearch', { ...cmd, vehicleType: 'TRUCK' }, { 'x-service-token': 'trip-token' }), (e: CallError) => e.status === 400 && e.code === 'INVALID_REQUEST');
    const event = { schemaVersion: 1, eventId: randomUUID(), type: 'trip.completed', tripId: randomUUID(), tripVersion: 7, occurredAt: new Date().toISOString(), data: { riderId: randomUUID(), status: 'COMPLETED' } };
    assert.deepEqual(await c.call('TripCompleted', event, { 'x-service-token': 'trip-token' }), { eventId: event.eventId, accepted: true });
    assert.equal((calls.at(-1)!.input as { data: { driverId: unknown } }).data.driverId, null, 'an unset optional field is null, as in the HTTP body');
    const ids = [randomUUID(), randomUUID()];
    const reply = await c.call<{ items: { driverId: string; tripId?: string }[] }>('DriverReservations', { driverIds: ids }, { 'x-service-token': 'driver-token' });
    assert.deepEqual(reply.items.map(i => [i.driverId, i.tripId ?? null]), [[ids[0], ids[0]], [ids[1], null]]);
    await assert.rejects(c.call('GetOffer', { offerId: randomUUID() }, { 'x-service-token': 'realtime-token' }), (e: CallError) => e.status === 404 && e.code === 'NOT_FOUND');
    assert.deepEqual(await c.call('DriverOffer', { driverId: randomUUID() }, { 'x-service-token': 'realtime-token' }), {});
  } finally { c.close(); await server.close(); }
});

test('gRPC failures open the breaker like HTTP ones; busy answers with Retry-After and 4xx do not', async () => {
  let failure: Failure = { status: 500, code: 'INTERNAL_ERROR' };
  const server = new GrpcServer(e => (e as { failure: Failure }).failure).add(matchingService(), { GetOffer: async () => { throw { failure }; } });
  const port = await server.listen('127.0.0.1', 0); const clock = { t: 0 };
  const c = client(port, new CircuitBreaker('matching', { failureThreshold: 2, openMs: 5000, now: () => clock.t, ...quiet }));
  try {
    failure = { status: 503, code: 'ROUTING_BUSY', retryAfter: '1' };
    for (let i = 0; i < 3; i++) await assert.rejects(c.call('GetOffer', { offerId: 'x' }), (e: CallError) => e.status === 503 && e.code === 'ROUTING_BUSY' && e.retryAfterMs === 1000);
    failure = { status: 409, code: 'VERSION_CONFLICT' };
    await assert.rejects(c.call('GetOffer', { offerId: 'x' }), (e: CallError) => e.status === 409 && e.code === 'VERSION_CONFLICT');
    assert.equal(c.breaker.state, 'closed');
    failure = { status: 500, code: 'INTERNAL_ERROR' };
    for (let i = 0; i < 2; i++) await assert.rejects(c.call('GetOffer', { offerId: 'x' }), (e: CallError) => e.status === 500);
    await assert.rejects(c.call('GetOffer', { offerId: 'x' }), (e: CallError) => e.status === 503 && e.code === 'CIRCUIT_OPEN' && e.retryAfterMs === 5000);
  } finally { c.close(); await server.close(); }
  const down = client(1);
  await assert.rejects(down.call('GetOffer', { offerId: 'x' }), (e: CallError) => e.status === 0 && e.code === 'UNREACHABLE'); down.close();
  const slow = new GrpcServer(() => ({ status: 500, code: 'X' })).add(matchingService(), { GetOffer: () => new Promise(r => setTimeout(() => r({}), 500)) });
  const slowPort = await slow.listen('127.0.0.1', 0); const s = client(slowPort);
  try { await assert.rejects(s.call('GetOffer', { offerId: 'x' }, {}, 50), (e: CallError) => e.status === 0 && e.code === 'TIMEOUT'); } finally { s.close(); await slow.close(1000); }
});

test('GrpcClients gives Matching the same data and errors as HttpClients', async () => {
  const driverId = randomUUID(), vehicleId = randomUUID(), tripId = randomUUID(), eventId = randomUUID();
  const seen: Record<string, string | undefined> = {};
  const servers: GrpcServer[] = [];
  const serve = async (file: string, name: string, handlers: Record<string, Handler>) => {
    const s = new GrpcServer(e => (e as { failure: Failure }).failure).add(loadService(file, name), handlers); servers.push(s); return `127.0.0.1:${await s.listen('127.0.0.1', 0)}`;
  };
  const env = {
    REALTIME_GRPC_ADDRESS: await serve('realtime.proto', 'chande.realtime.v1.RealtimeInternal', { ListDriverLocations: async (_r: unknown, call: UnaryCall) => { seen.realtime = header(call, 'x-service-token'); return { radiusMeters: 2000, drivers: [{ driverId, latitude: 21.03, longitude: 105.85, distanceMeters: 0, recordedAt: new Date().toISOString() }] }; } }),
    DRIVER_GRPC_ADDRESS: await serve('driver.proto', 'chande.driver.v1.DriverInternal', {
      CheckCandidates: async () => ({ items: [{ driverId, eligible: false, reasons: ['VEHICLE_REQUIRED'] }] }),
      CheckEligibility: async () => ({ driverId, profileEligible: true, desiredStatus: 'ONLINE', vehicleId, driverSnapshot: { fullName: 'A' }, vehicleSnapshot: { vehicleType: 'CAR_4', licensePlate: '30A-1' } }),
    }),
    ROUTING_GRPC_ADDRESS: await serve('routing.proto', 'chande.routing.v1.RoutingInternal', { EtaMatrix: async () => { throw { failure: { status: 503, code: 'ROUTING_BUSY', retryAfter: '1' } }; } }),
    TRIP_GRPC_ADDRESS: await serve('trip.proto', 'chande.trip.v1.TripInternal', {
      AssignTrip: async (r: { eventId: string; tripId: string; driverSnapshot: { avatarUrl?: string } }) => { assert.equal(r.driverSnapshot.avatarUrl, undefined); return { eventId: r.eventId, tripId: r.tripId, accepted: true, assignedVersion: 3 }; },
      GetMatchingState: async () => ({ found: false }),
    }),
  };
  const config = { realtimeUrl: 'http://realtime', driverUrl: 'http://driver', routingUrl: 'http://routing', tripUrl: 'http://trip', realtimeToken: 'rt', driverToken: 'dt', routingToken: 'ro', tripToken: 'tt', httpTimeout: 2000 } as Config;
  const clients = new GrpcClients(config, quiet, env);
  try {
    assert.equal((await clients.locations({ lat: 21, lng: 105 }, 200))[0]!.driverId, driverId); assert.equal(seen.realtime, 'rt');
    assert.deepEqual(await clients.candidates([driverId], 'CAR_4'), [{ driverId, eligible: false, reasons: ['VEHICLE_REQUIRED'], vehicleId: null, driverSnapshot: null, vehicleSnapshot: null }]);
    assert.deepEqual((await clients.driver(driverId, 'CAR_4')).vehicleSnapshot, { vehicleType: 'CAR_4', licensePlate: '30A-1', brand: null, color: null });
    const busy = await clients.eta({ lat: 21, lng: 105 }, 'CAR_4', [{ id: driverId, lat: 21, lng: 105 }]).catch((e: unknown) => e);
    assert.ok(busy instanceof UpstreamError); assert.deepEqual(describeFailure(busy), { dependency: 'routing', code: 'ROUTING_BUSY', status: 503, retryAfterMs: 1000 });
    await clients.assign(tripId, { eventId, driverId, vehicleId, driverSnapshot: { fullName: 'A', avatarUrl: null }, vehicleSnapshot: { vehicleType: 'CAR_4', licensePlate: '30A-1', brand: null, color: null } });
    assert.equal(describeFailure(await clients.trip(tripId).catch((e: unknown) => e)).code, 'INVALID_RESPONSE', 'a missing trip is rejected like data: null over HTTP');
  } finally { clients.close(); await Promise.all(servers.map(s => s.close())); }
});
