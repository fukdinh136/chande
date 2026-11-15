const { test } = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const { realtimeGrpc } = require('../dist/presentation/grpc/driver-locations.grpc');
const { ListDriverLocations } = require('../dist/application/use-cases/list-driver-locations');
const { OfferConsumer } = require('../dist/infrastructure/offers/consumer');
const { CircuitBreaker } = require('../dist/infrastructure/circuit-breaker');
const { GrpcClient, GrpcServer, loadService } = require('../dist/infrastructure/grpc');
const quiet = { onChange: () => {} };

test('Realtime serves fresh driver locations over gRPC with the same token check and input rules', async () => {
  const driverId = randomUUID(), recordedAt = new Date().toISOString(); let asked;
  const list = new ListDriverLocations({ nearest: async q => { asked = q; return [{ driverId, latitude: 21.03, longitude: 105.85, distanceMeters: 12.5, recordedAt }]; } }, { fresh: () => true });
  const server = realtimeGrpc(list, 'matching-token'); const port = await server.listen('127.0.0.1', 0);
  const c = new GrpcClient(loadService('realtime.proto', 'chande.realtime.v1.RealtimeInternal'), `127.0.0.1:${port}`, 2000, new CircuitBreaker('realtime', quiet));
  try {
    const reply = await c.call('ListDriverLocations', { latitude: 21.03, longitude: 105.85, limit: 200 }, { 'x-service-token': 'matching-token' });
    assert.deepEqual(reply, { radiusMeters: 2000, drivers: [{ driverId, latitude: 21.03, longitude: 105.85, distanceMeters: 12.5, recordedAt }] });
    assert.deepEqual(asked, { latitude: 21.03, longitude: 105.85, radiusMeters: 2000, limit: 200 }, 'an unset radius takes the same default as the HTTP query');
    await assert.rejects(c.call('ListDriverLocations', { latitude: 21, longitude: 105, limit: 201 }, { 'x-service-token': 'matching-token' }), e => e.status === 400 && e.code === 'INVALID_REQUEST');
    await assert.rejects(c.call('ListDriverLocations', { latitude: 21, longitude: 105 }, { 'x-service-token': 'other' }), e => e.status === 401 && e.code === 'INVALID_SERVICE_CREDENTIAL');
  } finally { c.close(); await server.close(); }
});

test('offer lookup over gRPC: current offer, missing offer as null, failure as MATCHING_UNAVAILABLE', async () => {
  const driverId = randomUUID(), offerId = randomUUID(); let down = false;
  const offer = { offerId, tripId: randomUUID(), driverId, version: 1, status: 'PENDING', expiresAt: new Date(Date.now() + 20000).toISOString(), pickup: { lat: 21, lng: 105, address: 'A' }, destination: { lat: 21.1, lng: 105.1 }, vehicleType: 'CAR_4', fare: { currency: 'VND', amount: '45000' } };
  const server = new GrpcServer(e => e.failure).add(loadService('matching.proto', 'chande.matching.v1.MatchingInternal'), {
    DriverOffer: async r => { if (down) throw { failure: { status: 500, code: 'INTERNAL_ERROR' } }; return r.driverId === driverId ? { offer } : {}; },
    GetOffer: async r => { if (r.offerId !== offerId) throw { failure: { status: 404, code: 'NOT_FOUND' } }; return offer; },
  });
  const port = await server.listen('127.0.0.1', 0);
  const grpc = new GrpcClient(loadService('matching.proto', 'chande.matching.v1.MatchingInternal'), `127.0.0.1:${port}`, 3000, new CircuitBreaker('matching', quiet));
  const consumer = new OfferConsumer({}, { rabbitUrl: '', matchingUrl: 'http://matching', matchingToken: 't' }, undefined, grpc);
  try {
    assert.deepEqual(await consumer.lookup(`/internal/matching/drivers/${driverId}/offer`), offer);
    assert.equal(await consumer.lookup(`/internal/matching/drivers/${randomUUID()}/offer`), null);
    assert.equal((await consumer.lookup(`/internal/matching/offers/${offerId}`)).offerId, offerId);
    assert.equal(await consumer.lookup(`/internal/matching/offers/${randomUUID()}`), null);
    down = true; await assert.rejects(consumer.lookup(`/internal/matching/drivers/${driverId}/offer`), /MATCHING_UNAVAILABLE/);
  } finally { grpc.close(); await server.close(); }
});
