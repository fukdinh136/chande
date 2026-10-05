import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EstimateTrip } from '../../src/application/use-cases/estimate';
import type { Store, Transaction } from '../../src/application/ports/store';
import type { Quote } from '../../src/domain/models';
import { driver, now, quote, rider } from '../fixtures';
test('Estimate saves only a quote after both dependencies succeed and starts TTL after computation', async () => {
  let saved: Quote | undefined; const calls: string[] = [];
  const store: Store = { ready: async () => true, transaction: async work => work({ saveQuote: async q => { saved = q; } } as Transaction) };
  const estimate = new EstimateTrip(store, { estimate: async () => { calls.push('route'); return quote().route; } }, { estimate: async () => { calls.push('price'); return quote().fare; } }, { now: () => now, id: randomUUID }, ['MOCK_BIKE']);
  const result = await estimate.execute(rider, quote(), randomUUID());
  assert.deepEqual(calls, ['route', 'price']); assert.equal(saved?.riderId, rider.sub);
  assert.equal(Date.parse(result.expiresAt) - Date.parse(result.createdAt), 300000);
  assert.equal('riderId' in result, false); assert.equal('consumedTripId' in result, false);
  await assert.rejects(estimate.execute(driver, quote(), randomUUID()), { code: 'FORBIDDEN_ACTION' });
});
test('Estimate failure does not save a partial quote or call Pricing after Routing fails', async () => {
  let wrote = false; let priced = false;
  const store: Store = { ready: async () => true, transaction: async work => { wrote = true; return work({} as Transaction); } };
  const estimate = new EstimateTrip(store, { estimate: async () => { throw new Error('routing offline'); } }, { estimate: async () => { priced = true; return quote().fare; } }, { now: () => now, id: randomUUID }, ['MOCK_BIKE']);
  await assert.rejects(estimate.execute(rider, quote(), randomUUID()), /offline/);
  assert.equal(wrote, false); assert.equal(priced, false);
});
