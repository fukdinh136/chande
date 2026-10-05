import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PgStore } from '../../src/infrastructure/persistence/store';
import { CreateTrip } from '../../src/application/use-cases/create';
import { clearDatabase, testDatabase } from '../database';
import { now, quote, rider } from '../fixtures';
let store: PgStore; const runtime = { now: () => now, id: randomUUID };
before(async () => { store = await testDatabase(); }); beforeEach(async () => clearDatabase(store)); after(async () => { await store?.db.destroy(); });
async function create(owner = rider) { const q = { ...quote(), quoteId: randomUUID(), riderId: owner.sub }; await store.transaction(tx => tx.saveQuote(q)); return (await new CreateTrip(store, runtime).execute(owner, q.quoteId, randomUUID())).value; }
import { CancelTrip } from '../../src/application/use-cases/cancel';
import { GetTrip, HistoryCursor } from '../../src/application/use-cases/get';
test('history pagination is scoped, deterministic and excludes active Trips', async () => {
  const first = await create(); await new CancelTrip(store, runtime).execute(rider, first.tripId, 'one', 1, randomUUID());
  const second = await create(); await new CancelTrip(store, runtime).execute(rider, second.tripId, 'two', 1, randomUUID());
  await create(); const get = new GetTrip(store, new HistoryCursor('test-key')); const page = await get.list(rider, 1); assert.ok(page.nextCursor);
  const next = await get.list(rider, 1, undefined, page.nextCursor); assert.equal(next.items.length, 1); assert.notEqual(page.items[0]!.tripId, next.items[0]!.tripId); assert.equal(next.nextCursor, null);
  await assert.rejects(get.list({ ...rider, sub: randomUUID() }, 1, undefined, page.nextCursor), { code: 'INVALID_CURSOR' });
  await assert.rejects(get.detail({ ...rider, sub: randomUUID() }, first.tripId), { code: 'RESOURCE_NOT_FOUND' });
});
