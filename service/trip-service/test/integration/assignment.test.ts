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
import { NoDriverFound } from '../../src/application/use-cases/no-driver';
// ADR-0004: Matching's search deadline cancels a SEARCHING trip as SYSTEM, once, and never undoes an assignment.
test('no driver found cancels a searching trip once and loses to an assignment', async () => {
  const lonely = await create(); const noDriver = new NoDriverFound(store, runtime), eventId = randomUUID();
  const first = await noDriver.execute(lonely.tripId, eventId); assert.equal(first.replayed, false);
  const replay = await noDriver.execute(lonely.tripId, eventId); assert.equal(replay.replayed, true); assert.deepEqual(replay.value, first.value);
  const saved = await store.transaction(tx => tx.findTrip(lonely.tripId));
  assert.equal(saved?.status, 'CANCELLED'); assert.deepEqual(saved?.cancellation && { ...saved.cancellation, cancelledAt: undefined }, { actorType: 'SYSTEM', actorId: null, reason: 'NO_DRIVER_FOUND', cancelledAt: undefined });
  assert.equal(first.value.cancelledVersion, saved?.version);
  const kinds: { kind: string; type: string }[] = await store.db.query("SELECT kind, payload->>'type' AS type FROM outbox WHERE trip_id=$1 AND trip_version=$2 ORDER BY kind", [lonely.tripId, saved!.version]);
  assert.deepEqual(kinds, [{ kind: 'cancel', type: 'matching.search.cancelled' }, { kind: 'event', type: 'trip.cancelled' }]);
  await assert.rejects(new ReceiveAssignment(store, runtime).execute(lonely.tripId, assignment()), { code: 'TRIP_NOT_SEARCHING' });
  const won = await create({ ...rider, sub: randomUUID() }); await new ReceiveAssignment(store, runtime).execute(won.tripId, { ...assignment(), eventId: randomUUID() });
  await assert.rejects(noDriver.execute(won.tripId, randomUUID()), { code: 'TRIP_NOT_SEARCHING' });
  assert.equal((await store.transaction(tx => tx.findTrip(won.tripId)))?.status, 'ASSIGNED');
});
