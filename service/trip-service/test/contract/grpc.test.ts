import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tripGrpc } from '../../src/api/grpc';
import type { TripContext } from '../../src/bootstrap/context';
import { DomainError } from '../../src/domain/error';
import { CircuitBreaker } from '../../src/infrastructure/circuit-breaker';
import { CallError, GrpcClient, GrpcServer, header, loadService, type Failure, type Handler, type UnaryCall } from '../../src/infrastructure/grpc';
import { GrpcMatchingClient, GrpcPricingClient, GrpcRoutingClient } from '../../src/infrastructure/clients/grpc';
import { quote } from '../fixtures';

const quiet = { onChange: () => {} };
const tripService = () => loadService('trip.proto', 'chande.trip.v1.TripInternal');

test('Trip serves assignment, matching state, driver lookups and the active trip over gRPC like HTTP', async () => {
  const tripId = randomUUID(), driverId = randomUUID(), vehicleId = randomUUID(), eventId = randomUUID(); let assigned: unknown; let authorization: string | undefined;
  const context = {
    config: { callbackToken: 'matching-token', driverLookupToken: 'driver-token' },
    assignment: { execute: async (id: string, input: unknown) => { assigned = input; return { value: { eventId, tripId: id, accepted: true, assignedVersion: 4 }, replayed: false }; } },
    store: { transaction: async (work: (tx: unknown) => unknown) => work({ findTrip: async (id: string) => id === tripId ? { tripId, status: 'ASSIGNED', driverId: null, version: 4 } : null, activeTripsByDriver: async () => new Map([[driverId, tripId]]) }) },
    identity: { verify: async (h: string | undefined) => { authorization = h; if (h !== 'Bearer ok') throw new DomainError('UNAUTHENTICATED'); return { role: 'DRIVER', sub: driverId }; } },
    get: { active: async () => ({ tripId, vehicleId: null, status: 'ASSIGNED', version: 4 }) },
  } as unknown as TripContext;
  const server = tripGrpc(context); const port = await server.listen('127.0.0.1', 0);
  const c = new GrpcClient(tripService(), `127.0.0.1:${port}`, 2000, new CircuitBreaker('trip', quiet));
  try {
    const assignment = { tripId, eventId, driverId, vehicleId, driverSnapshot: { fullName: 'Driver A' }, vehicleSnapshot: { vehicleType: 'CAR_4', licensePlate: '30A-12345' } };
    assert.deepEqual(await c.call('AssignTrip', assignment, { 'x-service-token': 'matching-token' }), { eventId, tripId, accepted: true, assignedVersion: 4 });
    assert.deepEqual(assigned, { eventId, driverId, vehicleId, driverSnapshot: { fullName: 'Driver A', avatarUrl: null }, vehicleSnapshot: { vehicleType: 'CAR_4', licensePlate: '30A-12345', brand: null, color: null } });
    await assert.rejects(c.call('AssignTrip', assignment, { 'x-service-token': 'wrong' }), (e: CallError) => e.status === 401 && e.code === 'INVALID_SERVICE_CREDENTIAL');
    await assert.rejects(c.call('AssignTrip', { ...assignment, tripId: 'nope' }, { 'x-service-token': 'matching-token' }), (e: CallError) => e.status === 400 && e.code === 'INVALID_REQUEST');
    assert.deepEqual(await c.call('GetMatchingState', { tripId }, { 'x-service-token': 'matching-token' }), { found: true, tripId, status: 'ASSIGNED', version: 4 });
    assert.deepEqual(await c.call('GetMatchingState', { tripId: randomUUID() }, { 'x-service-token': 'matching-token' }), { found: false, tripId: '', status: '', version: 0 });
    assert.deepEqual(await c.call('ActiveDriverTrips', { driverIds: [driverId] }, { 'x-service-token': 'driver-token' }), { items: [{ driverId, tripId }] });
    assert.deepEqual(await c.call('GetActiveTrip', {}, { authorization: 'Bearer ok' }), { trip: { tripId, status: 'ASSIGNED', version: 4 } });
    assert.equal(authorization, 'Bearer ok', 'the driver JWT travels as authorization metadata');
    await assert.rejects(c.call('GetActiveTrip', {}, { authorization: 'Bearer bad' }), (e: CallError) => e.status === 401 && e.code === 'UNAUTHENTICATED');
  } finally { c.close(); await server.close(); }
});

async function stub(file: string, name: string, handlers: Record<string, Handler>) {
  const server = new GrpcServer(e => (e as { failure: Failure }).failure).add(loadService(file, name), handlers);
  return { server, address: `127.0.0.1:${await server.listen('127.0.0.1', 0)}` };
}
const client = (file: string, name: string, address: string) => new GrpcClient(loadService(file, name), address, 2000, new CircuitBreaker('x', quiet));

test('Trip gRPC clients keep the HTTP results: estimate failures as DEPENDENCY_UNAVAILABLE, outbox errors retryable or not', async () => {
  let token: string | undefined; let busy = false;
  const routing = await stub('routing.proto', 'chande.routing.v1.RoutingInternal', { Estimate: async (_r: unknown, call: UnaryCall) => { token = header(call, 'x-service-token'); if (busy) throw { failure: { status: 503, code: 'ROUTING_BUSY', retryAfter: '1' } }; return { distanceMeters: 4000, durationSeconds: 600 }; } });
  const price = await stub('price.proto', 'chande.price.v1.PriceInternal', { EstimateFare: async () => ({ currency: 'VND', amount: '45000', breakdown: [{ code: 'BASE', amount: '45000' }] }) });
  let commandFailure: Failure | null = null;
  const matching = await stub('matching.proto', 'chande.matching.v1.MatchingInternal', {
    StartSearch: async (r: { commandId: string }) => { if (commandFailure) throw { failure: commandFailure }; return { commandId: r.commandId, accepted: true }; },
    TripCompleted: async (r: { eventId: string; data: { driverId?: string } }) => { assert.equal(r.data.driverId, undefined); return { eventId: r.eventId, accepted: true }; },
  });
  const r = new GrpcRoutingClient(client('routing.proto', 'chande.routing.v1.RoutingInternal', routing.address), 'routing-token');
  const p = new GrpcPricingClient(client('price.proto', 'chande.price.v1.PriceInternal', price.address), 'pricing-token');
  const m = new GrpcMatchingClient(client('matching.proto', 'chande.matching.v1.MatchingInternal', matching.address), 'matching-token');
  const down = new GrpcMatchingClient(client('matching.proto', 'chande.matching.v1.MatchingInternal', '127.0.0.1:1'), 'matching-token');
  try {
    const q = quote();
    assert.deepEqual(await r.estimate(q.pickup, q.destination, 'MOCK_BIKE', randomUUID()), { distanceMeters: 4000, durationSeconds: 600 }); assert.equal(token, 'routing-token');
    busy = true; await assert.rejects(r.estimate(q.pickup, q.destination, 'MOCK_BIKE', randomUUID()), { code: 'DEPENDENCY_UNAVAILABLE' });
    assert.equal((await p.estimate({ distanceMeters: 4000, durationSeconds: 600 }, 'MOCK_BIKE', randomUUID())).amount, '45000');
    const command = { commandId: randomUUID(), type: 'matching.search.requested', tripId: randomUUID() };
    await m.send('search', command, randomUUID());
    commandFailure = { status: 409, code: 'COMMAND_CONFLICT' }; await assert.rejects(m.send('search', command, randomUUID()), { reason: 'COMMAND_CONFLICT', retryable: false });
    commandFailure = { status: 503, code: 'DEPENDENCY_UNAVAILABLE', retryAfter: '1' }; await assert.rejects(m.send('search', command, randomUUID()), { reason: 'DEPENDENCY_UNAVAILABLE', retryable: true });
    await m.event({ schemaVersion: 1, eventId: randomUUID(), type: 'trip.completed', tripId: randomUUID(), tripVersion: 3, occurredAt: new Date().toISOString(), data: { riderId: randomUUID(), driverId: null, status: 'COMPLETED' } }, randomUUID());
    await assert.rejects(m.event({ type: 'trip.cancelled' }, randomUUID()), { reason: 'INVALID_REQUEST', retryable: false });
    await assert.rejects(down.send('search', command, randomUUID()), { reason: 'NETWORK_ERROR', retryable: true });
  } finally { await Promise.all([routing.server.close(), price.server.close(), matching.server.close()]); }
});
