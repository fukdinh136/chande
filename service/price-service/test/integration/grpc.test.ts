import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceGrpc } from '../../src/api/grpc';
import { CalculateFare } from '../../src/application/calculate';
import { loadConfig } from '../../src/bootstrap/config';
import { FarePolicy } from '../../src/domain/fare';
import { CircuitBreaker } from '../../src/infrastructure/circuit-breaker';
import { CallError, GrpcClient, loadService } from '../../src/infrastructure/grpc';

test('Price gRPC gives the same fare, auth and validation as HTTP', async () => {
  const config = loadConfig({ PRICE_TRIP_TOKEN: 'test-price-token' });
  const server = priceGrpc(config, new CalculateFare(new FarePolicy(config.policy), config.vehicles)); const port = await server.listen('127.0.0.1', 0);
  const c = new GrpcClient(loadService('price.proto', 'chande.price.v1.PriceInternal'), `127.0.0.1:${port}`, 2000, new CircuitBreaker('price', { onChange: () => {} }));
  const input = { route: { distanceMeters: 4000, durationSeconds: 600 }, vehicleType: 'CAR' };
  try {
    assert.deepEqual(await c.call('EstimateFare', input, { 'x-service-token': 'test-price-token' }), { currency: 'VND', amount: '42000', breakdown: [{ code: 'BASE_FARE', amount: '12000' }, { code: 'DISTANCE_FARE', amount: '30000' }] });
    await assert.rejects(c.call('EstimateFare', input, { 'x-service-token': 'bad' }), (e: CallError) => e.status === 401 && e.code === 'INVALID_SERVICE_CREDENTIAL');
    await assert.rejects(c.call('EstimateFare', { ...input, vehicleType: 'CAR 4' }, { 'x-service-token': 'test-price-token' }), (e: CallError) => e.status === 400);
  } finally { c.close(); await server.close(); }
});
