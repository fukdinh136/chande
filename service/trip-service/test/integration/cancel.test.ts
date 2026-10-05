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
import { CancelTrip } from '../../src/application/use-cases/cancel';
test('callback replay after cancellation is an ACK only; a new callback cannot reopen Trip', async () => {
  const trip = await create(); const receive = new ReceiveAssignment(store, runtime); const input = assignment();
  await receive.execute(trip.tripId, input); await new CancelTrip(store, runtime).execute(rider, trip.tripId, 'stop', 2, randomUUID());
  assert.equal((await receive.execute(trip.tripId, input)).replayed, true);
  assert.equal((await store.transaction(tx => tx.findTrip(trip.tripId)))?.status, 'CANCELLED');
  await assert.rejects(receive.execute(trip.tripId, { ...input, eventId: randomUUID() }), { code: 'TRIP_ALREADY_ASSIGNED' });
  await assert.rejects(receive.execute(trip.tripId, { ...input, driverId: randomUUID() }), { code: 'EVENT_ID_REUSED' });
});
test('cancel versus assignment resolves atomically without inconsistent history', async () => {
  const trip = await create(); const results = await Promise.allSettled([new CancelTrip(store, runtime).execute(rider, trip.tripId, 'stop', 1, randomUUID()), new ReceiveAssignment(store, runtime).execute(trip.tripId, assignment())]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const current = await store.transaction(tx => tx.findTrip(trip.tripId)); assert.ok(current); assert.ok(['CANCELLED', 'ASSIGNED'].includes(current.status));
  assert.equal(current.version, 2); assert.equal((await store.transaction(tx => tx.history(trip.tripId))).length, 3);
});
test('driver cancellation terminates Trip without rematching and remains idempotent', async () => {
  const trip = await create(); await new ReceiveAssignment(store, runtime).execute(trip.tripId, assignment()); const cancel = new CancelTrip(store, runtime); const key = randomUUID();
  const result = await cancel.execute(driver, trip.tripId, 'changed', 2, key); assert.equal(result.value.status, 'CANCELLED'); assert.equal(result.value.fare.finalAmount, null);
  assert.equal((await cancel.execute(driver, trip.tripId, ' changed ', 2, key)).replayed, true);
  const commands: { kind: string }[] = await store.db.query("SELECT kind FROM outbox WHERE kind<>'event'"); assert.deepEqual(commands.map(c => c.kind).sort(), ['cancel', 'search']);
});
