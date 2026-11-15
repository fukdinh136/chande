const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { driverGrpc } = require('../../src/presentation/grpc/internal.grpc');
const { CircuitBreaker } = require('../../src/infrastructure/circuit-breaker');
const { GrpcClient, GrpcServer, header, loadService } = require('../../src/infrastructure/grpc');
const { GrpcOccupancy, GrpcTripActive } = require('../../src/infrastructure/clients/grpc.client');
const { DriverError } = require('../../src/domain/value-objects/error');
const quiet = { onChange: () => {} };
const service = (file, name) => loadService(file, name);

test('Driver serves candidate and single eligibility over gRPC with the same token, input rules and errors', async () => {
  const id = randomUUID(); let asked;
  const context = { config: { matchingToken: 'matching-token' },
    candidates: { execute: async (ids, type) => { asked = [ids, type]; return { items: ids.map(driverId => ({ driverId, eligible: false, reasons: ['VEHICLE_REQUIRED'], vehicleId: null, driverSnapshot: null, vehicleSnapshot: null })) }; } },
    eligibility: { eligibility: async () => { throw new DriverError('RESOURCE_NOT_FOUND'); } } };
  const server = driverGrpc(context); const port = await server.listen('127.0.0.1', 0);
  const c = new GrpcClient(service('driver.proto', 'chande.driver.v1.DriverInternal'), `127.0.0.1:${port}`, 2000, new CircuitBreaker('driver', quiet));
  const token = { 'x-service-token': 'matching-token' };
  try {
    const reply = await c.call('CheckCandidates', { driverIds: [id], vehicleType: 'CAR_4' }, token);
    assert.deepEqual(reply, { items: [{ driverId: id, eligible: false, reasons: ['VEHICLE_REQUIRED'] }] }, 'null vehicle and snapshots stay unset');
    assert.deepEqual(asked, [[id], 'CAR_4']);
    await assert.rejects(c.call('CheckCandidates', { driverIds: [id, id], vehicleType: 'CAR_4' }, token), e => e.status === 400 && e.code === 'INVALID_REQUEST');
    await assert.rejects(c.call('CheckCandidates', { driverIds: [id], vehicleType: 'CAR 4' }, token), e => e.status === 400);
    await assert.rejects(c.call('CheckCandidates', { driverIds: [id], vehicleType: 'CAR_4' }, { 'x-service-token': 'nope' }), e => e.status === 401 && e.code === 'INVALID_SERVICE_CREDENTIAL');
    await assert.rejects(c.call('CheckEligibility', { driverId: id, vehicleType: 'CAR_4' }, token), e => e.status === 404 && e.code === 'RESOURCE_NOT_FOUND');
  } finally { c.close(); await server.close(); }
});

test('Driver gRPC clients: occupancy from Trip and Matching, active trip with the driver JWT, failures never mean free', async () => {
  const id = randomUUID(), tripId = randomUUID(); let tripFails = false, seenAuth;
  const servers = [];
  const stub = async (file, name, handlers) => { const s = new GrpcServer(e => e.failure).add(service(file, name), handlers); servers.push(s); return `127.0.0.1:${await s.listen('127.0.0.1', 0)}`; };
  const tripAddress = await stub('trip.proto', 'chande.trip.v1.TripInternal', {
    ActiveDriverTrips: async r => { if (tripFails) throw { failure: { status: 500, code: 'INTERNAL_ERROR' } }; return { items: r.driverIds.map(driverId => ({ driverId })) }; },
    GetActiveTrip: async (_r, call) => { seenAuth = header(call, 'authorization'); if (seenAuth !== 'Bearer ok') throw { failure: { status: 401, code: 'UNAUTHENTICATED' } }; return { trip: { tripId, status: 'ASSIGNED', version: 2 } }; },
  });
  const matchingAddress = await stub('matching.proto', 'chande.matching.v1.MatchingInternal', { DriverReservations: async r => ({ items: r.driverIds.map(driverId => ({ driverId, tripId })) }) });
  const client = (file, name, address) => new GrpcClient(service(file, name), address, 2000, new CircuitBreaker('x', quiet));
  const trip = client('trip.proto', 'chande.trip.v1.TripInternal', tripAddress);
  const occupancy = new GrpcOccupancy(trip, 'trip-token', client('matching.proto', 'chande.matching.v1.MatchingInternal', matchingAddress), 'matching-token');
  const active = new GrpcTripActive(trip);
  try {
    assert.equal((await occupancy.lookup([id])).get(id), true, 'a reservation in Matching makes the driver busy');
    tripFails = true; await assert.rejects(occupancy.lookup([id]), /DEPENDENCY_UNAVAILABLE/);
    assert.deepEqual(await active.active('Bearer ok'), { tripId, vehicleId: null }); assert.equal(seenAuth, 'Bearer ok');
    await assert.rejects(active.active('Bearer bad'), /UNAUTHENTICATED/);
  } finally { await Promise.all(servers.map(s => s.close())); }
});
