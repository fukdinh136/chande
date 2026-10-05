import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PgStore } from '../../src/infrastructure/persistence/store';
import { PgOutbox } from '../../src/infrastructure/outbox/repository';
import { OutboxDispatcher } from '../../src/infrastructure/outbox/dispatcher';
import { TransportError } from '../../src/infrastructure/clients/http';
import { Trip } from '../../src/domain/trip';
import { clearDatabase, testDatabase } from '../database';
import { now, quote, rider } from '../fixtures';
let store: PgStore; let outbox: PgOutbox;
before(async () => { store = await testDatabase(); outbox = new PgOutbox(store.db); }); beforeEach(async () => clearDatabase(store)); after(async () => { await store?.db.destroy(); });
async function seed(kind: 'search' | 'event' = 'event', cancelled = false): Promise<void> {
  await store.transaction(async tx => {
    const q = quote(); await tx.saveQuote(q); let trip = Trip.create(randomUUID(), q, rider.sub, now).search(now).trip;
    if (cancelled) trip = trip.cancel(rider, 'stop', 1, now).trip;
    await tx.saveTrip(trip.snapshot()); await tx.enqueue({ id: randomUUID(), tripId: trip.snapshot().tripId, tripVersion: trip.snapshot().version, kind, payload: {} }, kind === 'search' ? ['matching'] : ['gateway', 'notification']);
  });
}
const config = { batchSize: 20, concurrency: 5, leaseMs: 1000, retryBase: 1, retryMax: 10 };
test('concurrent workers claim disjoint deliveries and stale owners cannot ACK reclaimed work', async () => {
  await seed(); const a = randomUUID(); const b = randomUUID();
  const [first, second] = await Promise.all([outbox.claim(a, 1, 10000), outbox.claim(b, 1, 10000)]);
  assert.equal(first.length, 1); assert.equal(second.length, 1); assert.notEqual(first[0]!.id, second[0]!.id);
  await store.db.query("UPDATE outbox_deliveries SET lease_until=now()-interval '1 second' WHERE id=$1", [first[0]!.id]);
  const nextOwner = randomUUID(); const reclaimed = await outbox.claim(nextOwner, 1, 10000);
  assert.equal(reclaimed[0]!.id, first[0]!.id);
  assert.equal(await outbox.finish(first[0]!.id, a, 'delivered'), false);
  assert.equal(await outbox.finish(first[0]!.id, nextOwner, 'delivered'), true);
});
test('destinations progress independently and blocked credentials can be requeued', async () => {
  await seed();
  const dispatcher = new OutboxDispatcher(outbox, { send: async d => { if (d.destination === 'notification') throw new TransportError(false, 'HTTP_401'); } }, config);
  await dispatcher.tick();
  const rows: { id: string; destination: string; status: string }[] = await store.db.query('SELECT id::text,destination,status FROM outbox_deliveries');
  assert.equal(rows.find(r => r.destination === 'gateway')?.status, 'delivered');
  const blocked = rows.find(r => r.destination === 'notification')!; assert.equal(blocked.status, 'blocked');
  assert.equal(await outbox.requeue(blocked.id), true);
  await new OutboxDispatcher(outbox, { send: async () => {} }, config).tick();
  const pending: { count: string }[] = await store.db.query("SELECT count(*) FROM outbox_deliveries WHERE status<>'delivered'"); assert.equal(pending[0]?.count, '0');
});
test('transient send failure stays pending and cancelled Trip suppresses late search', async () => {
  await seed('search'); await new OutboxDispatcher(outbox, { send: async () => { throw new TransportError(true, 'HTTP_503'); } }, config).tick();
  const rows: { status: string }[] = await store.db.query('SELECT status FROM outbox_deliveries'); assert.equal(rows[0]?.status, 'pending');
  await clearDatabase(store); await seed('search', true); let sent = false;
  await new OutboxDispatcher(outbox, { send: async () => { sent = true; } }, config).tick();
  assert.equal(sent, false); const skipped: { status: string }[] = await store.db.query('SELECT status FROM outbox_deliveries'); assert.equal(skipped[0]?.status, 'skipped');
});
