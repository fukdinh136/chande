import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MatchingClient } from '../../src/infrastructure/clients/matching';
import { JsonHttpClient } from '../../src/infrastructure/clients/http';
import { envelope, withServer } from '../http-server';
test('Matching retains command ID for start/cancel retries and only accepts durable ACK', async () => {
  const commandId = randomUUID(); const tripId = randomUUID(); const seen: string[] = [];
  await withServer((req, body) => { seen.push(req.url!); assert.equal(body.commandId, commandId); return { status: 202, body: envelope({ commandId, accepted: true }, req.headers['x-request-id']) }; }, async url => {
    const client = new MatchingClient(new JsonHttpClient(url, 'matching-only', 1000));
    await client.send('search', { commandId, tripId }, randomUUID()); await client.send('search', { commandId, tripId }, randomUUID()); await client.send('cancel', { commandId, tripId }, randomUUID());
  });
  assert.deepEqual(seen, ['/internal/matching/requests', '/internal/matching/requests', `/internal/matching/requests/${tripId}/cancel`]);
});
test('Matching rejects mismatched ACK instead of losing command', async () => {
  await withServer(req => ({ status: 202, body: envelope({ commandId: randomUUID(), accepted: true }, req.headers['x-request-id']) }), async url => {
    await assert.rejects(new MatchingClient(new JsonHttpClient(url, 'x', 1000)).send('search', { commandId: randomUUID(), tripId: randomUUID() }, randomUUID()), { reason: 'INVALID_ACK' });
  });
});
