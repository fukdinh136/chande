import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMockServer } from '../../src/bootstrap/mock-server';
import { MatchingClient } from '../../src/infrastructure/clients/matching';
import { JsonHttpClient } from '../../src/infrastructure/clients/http';
import { withServer, envelope } from '../http-server';
import { assignment, quote } from '../fixtures';
import { RoutingClient } from '../../src/infrastructure/clients/routing';
import { PricingClient } from '../../src/infrastructure/clients/pricing';
test('development Matching mock persists ACK and terminal marker across restart and never auto assigns', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'chande-trip-mock-')); const file = join(directory, 'state.json'); const tripId = randomUUID();
  try { await withServer((req, body) => ({ status: 202, body: envelope({ eventId: body.eventId, tripId, accepted: true, assignedVersion: 2 }, req.headers['x-request-id']) }), async apiUrl => {
    const options = { file, apiUrl, callbackToken: 'callback', issuer: 'test', audience: 'test', tokens: { routing: 'routing', pricing: 'pricing', matching: 'matching', gateway: 'gateway', notification: 'notification' } };
    const input = { commandId: randomUUID(), tripId, tripVersion: 1, occurredAt: new Date().toISOString(), type: 'matching.search.cancelled' };
    for (let attempt = 0; attempt < 2; attempt++) {
      const server = await createMockServer(options); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
        const q = quote(); const route = await new RoutingClient(new JsonHttpClient(base, 'routing', 1000)).estimate(q.pickup, q.destination, q.vehicleType, randomUUID());
        assert.equal((await new PricingClient(new JsonHttpClient(base, 'pricing', 1000)).estimate(route, q.vehicleType, randomUUID())).amount, '45000');
        await new MatchingClient(new JsonHttpClient(base, 'matching', 1000)).send('cancel', input, randomUUID());
        await new MatchingClient(new JsonHttpClient(base, 'matching', 1000)).send('search', { ...input, commandId: randomUUID(), type: 'matching.search.requested' }, randomUUID());
        assert.equal((await fetch(base + '/mock/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...assignment(), tripId }) })).status, 409);
      } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    }
  }); } finally { rmSync(directory, { recursive: true, force: true }); }
});
