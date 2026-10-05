import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PgStore } from '../../src/infrastructure/persistence/store';
import { CreateTrip } from '../../src/application/use-cases/create';
import { clearDatabase, testDatabase } from '../database';
import { now, quote, rider } from '../fixtures';
let store: PgStore; const runtime = { now: () => now, id: randomUUID };
before(async () => { store = await testDatabase(); }); beforeEach(async () => clearDatabase(store)); after(async () => { await store?.db.destroy(); });

test('Create replay works after quote expiry/use and request reuse conflicts', async () => {
  const q = quote(); await store.transaction(tx => tx.saveQuote(q)); const key = randomUUID(); const create = new CreateTrip(store, runtime);
  const first = await create.execute(rider, q.quoteId, key);
  const replay = await new CreateTrip(store, { ...runtime, now: () => new Date(+now + 86400000) }).execute(rider, q.quoteId, key);
  assert.equal(replay.replayed, true); assert.deepEqual(replay.value, first.value);
  await assert.rejects(create.execute(rider, randomUUID(), key), { code: 'IDEMPOTENCY_KEY_REUSED' });
  const detail = await store.transaction(tx => tx.history(first.value.tripId)); assert.deepEqual(detail.map(h => h.version), [0, 1]);
});
test('concurrent identical request has one effect and different requests enforce rider active constraint', async () => {
  const q = quote(); await store.transaction(tx => tx.saveQuote(q)); const key = randomUUID(); const create = new CreateTrip(store, runtime);
  const result = await Promise.all([create.execute(rider, q.quoteId, key), create.execute(rider, q.quoteId, key)]);
  assert.equal(result[0]!.value.tripId, result[1]!.value.tripId); assert.equal(result.filter(r => r.replayed).length, 1);
  await assert.rejects(createAnother(), { code: 'ACTIVE_TRIP_EXISTS' });
  async function createAnother() { const other = { ...quote(), quoteId: randomUUID() }; await store.transaction(tx => tx.saveQuote(other)); return create.execute(rider, other.quoteId, randomUUID()); }
});
