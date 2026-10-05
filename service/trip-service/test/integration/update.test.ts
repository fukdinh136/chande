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
import { UpdateTrip } from '../../src/application/use-cases/update';
test('complete lifecycle fixes final fare and emits Matching completion event to release reservation', async () => {
  const trip = await create(); await new ReceiveAssignment(store, runtime).execute(trip.tripId, assignment()); const update = new UpdateTrip(store, runtime);
  await update.execute(driver, trip.tripId, 'DRIVER_ARRIVED', 2, randomUUID()); await update.execute(driver, trip.tripId, 'IN_PROGRESS', 3, randomUUID());
  const key = randomUUID(); const final = await update.execute(driver, trip.tripId, 'COMPLETED', 4, key); assert.equal(final.value.fare.finalAmount, '45000');
  assert.equal((await update.execute(driver, trip.tripId, 'COMPLETED', 4, key)).replayed, true);
  assert.equal(await store.transaction(tx => tx.active(driver)), null);
  const events: { count: string }[] = await store.db.query("SELECT count(*) FROM outbox o JOIN outbox_deliveries d ON d.outbox_id=o.id WHERE o.payload->>'type'='trip.completed' AND d.destination='matching'"); assert.equal(events[0]?.count, '1');
});
