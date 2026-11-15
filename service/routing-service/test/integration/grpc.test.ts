import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routingGrpc } from '../../src/api/grpc';
import { RoutingRuntime } from '../../src/bootstrap/runtime';
import { CircuitBreaker } from '../../src/infrastructure/circuit-breaker';
import { CallError, GrpcClient, loadService } from '../../src/infrastructure/grpc';
import { config, point } from '../helpers/fixtures';

test('gRPC estimate and eta-matrix: same scopes, validation and answers as HTTP', async () => {
  const runtime = new RoutingRuntime(config());
  const server = routingGrpc(runtime); const port = await server.listen('127.0.0.1', 0);
  const c = new GrpcClient(loadService('routing.proto', 'chande.routing.v1.RoutingInternal'), `127.0.0.1:${port}`, 5000, new CircuitBreaker('routing', { onChange: () => {} }));
  try {
    const input = { destination: point, vehicleType: 'MOCK_BIKE', origins: [{ id: 'driver-a', lat: point.lat, lng: point.lng }] };
    await assert.rejects(c.call('EtaMatrix', input, { 'x-service-token': 'trip-test-token' }), (e: CallError) => e.status === 403 && e.code === 'FORBIDDEN_OPERATION');
    await assert.rejects(c.call('EtaMatrix', { ...input, origins: [] }, { 'x-service-token': 'matching-test-token' }), (e: CallError) => e.status === 400 && e.code === 'INVALID_REQUEST');
    const matrix = await c.call<{ entries: { id: string; status: string }[]; calculatedAt: string }>('EtaMatrix', input, { 'x-service-token': 'matching-test-token' });
    assert.equal(matrix.entries.length, 1); assert.equal(matrix.entries[0]!.id, 'driver-a'); assert.ok(matrix.calculatedAt);
    const route = await c.call<{ distanceMeters: number; durationSeconds: number }>('Estimate', { pickup: point, destination: { lat: point.lat + 0.01, lng: point.lng + 0.01 }, vehicleType: 'MOCK_BIKE' }, { 'x-service-token': 'trip-test-token' });
    assert.ok(Number.isInteger(route.distanceMeters) && Number.isInteger(route.durationSeconds));
    await assert.rejects(c.call('Estimate', { pickup: point, destination: point, vehicleType: 'MOCK_BIKE' }, { 'x-service-token': 'unknown' }), (e: CallError) => e.status === 401 && e.code === 'INVALID_SERVICE_CREDENTIAL');
  } finally { c.close(); await server.close(); }
});
