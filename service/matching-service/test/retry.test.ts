import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpClients, UpstreamError } from '../src/infrastructure/clients';
import { BUSY_RETRY_MAX_MS, describeFailure, retryDelay } from '../src/application/retry';
import { MatchingError, type Command } from '../src/domain/models';
import type { Config } from '../src/bootstrap/config';

const command = { pickup: { lat: 21.0285, lng: 105.8542 }, vehicleType: 'CAR_4' } as Command;
async function routing(status: number, body: string, headers: Record<string, string> = {}): Promise<{ server: Server; url: string }> {
  const server = createServer((_req, res) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(body); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: 'http://127.0.0.1:' + (server.address() as AddressInfo).port };
}
const clients = (routingUrl: string) => new HttpClients({ routingUrl, routingToken: 't', driverUrl: 'http://driver', tripUrl: 'http://trip', httpTimeout: 2000 } as Config);

test('a busy Routing answer keeps its error code, dependency and Retry-After', async () => {
  const { server, url } = await routing(503, JSON.stringify({ error: { code: 'ROUTING_BUSY', message: 'ROUTING_BUSY' } }), { 'Retry-After': '1' });
  try {
    const error = await clients(url).matrix(command).then(() => null, (e: unknown) => e);
    assert.ok(error instanceof UpstreamError);
    assert.deepEqual(describeFailure(error), { dependency: 'routing', code: 'ROUTING_BUSY', status: 503, retryAfterMs: 1000 });
  } finally { server.close(); }
});

test('an unparseable error body falls back to HTTP_<status>; an unreachable service is UNREACHABLE', async () => {
  const { server, url } = await routing(500, '<html>oops</html>');
  try { assert.equal(describeFailure(await clients(url).matrix(command).catch((e: unknown) => e)).code, 'HTTP_500'); } finally { server.close(); }
  const failure = describeFailure(await clients('http://127.0.0.1:1').matrix(command).catch((e: unknown) => e));
  assert.equal(failure.code, 'UNREACHABLE'); assert.equal(failure.dependency, 'routing'); assert.equal(failure.status, null);
});

test('busy dependencies retry soon and never grow past the busy cap', () => {
  const busy = describeFailure(new UpstreamError(503, 'ROUTING_BUSY', 'routing', 1000));
  for (const attempt of [1, 5, 20]) assert.equal(retryDelay(attempt, busy, () => 1), 1000);
  assert.equal(retryDelay(9, describeFailure(new UpstreamError(503, 'ROUTING_BUSY', 'routing', 30000)), () => 1), BUSY_RETRY_MAX_MS);
  assert.equal(retryDelay(9, describeFailure(new UpstreamError(429, 'RATE_LIMITED', 'driver')), () => 1), 1000);
});

test('other failures keep the exponential backoff up to 30 s with jitter 0.8–1.0', () => {
  const other = describeFailure(new UpstreamError(503, 'REALTIME_UNAVAILABLE', 'routing'));
  assert.deepEqual([1, 2, 3, 6, 20].map(a => retryDelay(a, other, () => 1)), [1000, 2000, 4000, 30000, 30000]);
  assert.equal(retryDelay(1, other, () => 0), 800);
  assert.deepEqual(describeFailure(new MatchingError('NO_CANDIDATE', 409)), { dependency: 'matching', code: 'NO_CANDIDATE', status: 409, retryAfterMs: null });
  assert.equal(describeFailure(new Error('boom')).code, 'UNEXPECTED');
});
