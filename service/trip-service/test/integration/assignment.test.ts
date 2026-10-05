import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PgStore } from '../../src/infrastructure/persistence/store';
import { CreateTrip } from '../../src/application/use-cases/create';
import { clearDatabase, testDatabase } from '../database';
import { assignment, driver, now, quote, rider } from '../fixtures';
let store: PgStore; const runtime = { now: () => now, id: randomUUID };
before(async () => { store = await testDatabase(); }); beforeEach(async () => clearDatabase(store)); after(async () => { await store?.db.destroy(); });
async function create(owner = rider) { const q = { ...quote(), quoteId: randomUUID(), riderId: owner.sub }; await store.transaction(tx => tx.saveQuote(q)); return (await new CreateTrip(store, runtime).execute(owner, q.quoteId, randomUUID())).value; }
import { ReceiveAssignment } from '../../src/application/use-cases/assignment';
test('two drivers cannot win one Trip and one driver cannot win two Trips', async () => {
  const first = await create(); const second = await create({ ...rider, sub: randomUUID() }); const receive = new ReceiveAssignment(store, runtime);
  const results = await Promise.allSettled([receive.execute(first.tripId, assignment()), receive.execute(second.tripId, { ...assignment(), eventId: randomUUID() })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const failed = results.find(r => r.status === 'rejected'); assert.ok(failed?.status === 'rejected'); assert.equal(failed.reason.code, 'DRIVER_HAS_ACTIVE_TRIP');
  const assigned = await store.transaction(tx => tx.active(driver)); assert.ok(assigned);
  await assert.rejects(receive.execute(assigned.tripId, { ...assignment(), eventId: randomUUID(), driverId: randomUUID() }), { code: 'TRIP_ALREADY_ASSIGNED' });
});
