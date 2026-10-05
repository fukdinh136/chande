import { loadConfig } from '../../src/bootstrap/config';
import type { Context } from '../../src/application/ports/clients';
export function config(overrides: NodeJS.ProcessEnv = {}) {
  return loadConfig({ APP_ENV: 'test', ROUTING_TRIP_TOKEN: 'trip-test-token', ROUTING_MATCHING_TOKEN: 'matching-test-token', ROUTING_GATEWAY_TOKEN: 'gateway-test-token', ...overrides }, { read: () => JSON.stringify({ schemaVersion: 1, vehicleTypes: { MOCK_BIKE: { profile: 'mock_motorcycle', baseUrl: null } } }) });
}
export const point = { lat: 10.77, lng: 106.69 };
export const routeJob = { kind: 'route' as const, input: { origin: point, destination: { lat: 10.78, lng: 106.7 }, vehicleType: 'MOCK_BIKE', full: false, includeSteps: false } };
export const context = (signal = new AbortController().signal): Context => ({ requestId: '90000000-0000-4000-8000-000000000001', signal, deadline: performance.now() + 3000 });
export const tick = () => new Promise<void>(resolve => setImmediate(resolve));
