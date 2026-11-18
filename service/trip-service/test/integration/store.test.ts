import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PgStore } from '../../src/infrastructure/persistence/store';
import { Trip } from '../../src/domain/trip';
import { clearDatabase, testDatabase } from '../database';
import { now, quote, rider } from '../fixtures';
let store: PgStore;
before(async () => { store = await testDatabase(); }); beforeEach(async () => clearDatabase(store)); after(async () => { await store?.db.destroy(); });
test('migration and readiness on real PostgreSQL', async () => { assert.equal(await store.ready(), true); });
test('Trip, history, quote usage and outbox roll back together', async () => {
  await assert.rejects(store.transaction(async tx => {
    const q = quote(); await tx.saveQuote(q); const trip = Trip.create(randomUUID(), q, rider.sub, now).search(now);
    await tx.saveTrip(trip.trip.snapshot()); await tx.consumeQuote(q.quoteId, trip.trip.snapshot().tripId);
    await tx.addHistory(trip.trip.snapshot().tripId, [trip.history]);
    await tx.enqueue({ id: randomUUID(), tripId: trip.trip.snapshot().tripId, tripVersion: 1, kind: 'event', payload: {} }, ['gateway']);
    throw new Error('injected failure');
  }), /injected/);
  assert.equal(await store.transaction(tx => tx.active(rider)), null);
  assert.equal(await store.transaction(tx => tx.findQuote(quote().quoteId)), null);
  const rows: { count: string }[] = await store.db.query('SELECT count(*) FROM outbox'); assert.equal(rows[0]?.count, '0');
});
test('unique index prevents simultaneous active Trips for one rider', async () => {
  const results = await Promise.allSettled([1, 2].map(async () => store.transaction(async tx => {
    const q = { ...quote(), quoteId: randomUUID() }; await tx.saveQuote(q);
    await tx.saveTrip(Trip.create(randomUUID(), q, rider.sub, now).search(now).trip.snapshot());
  })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const failure = results.find(r => r.status === 'rejected'); assert.ok(failure?.status === 'rejected'); assert.equal(failure.reason.code, 'ACTIVE_TRIP_EXISTS');
});
test('rider active Trip is read from the two newest Trips, however long the history and whatever the statistics', async () => {
  // 40 cancelled Trips, one a minute, then an open one (quotes are valid at `now`, so requested_at is spread in SQL).
  const spread = (id: string, minutes: number) => store.db.query('UPDATE trips SET requested_at=$2 WHERE id=$1', [id, new Date(now.getTime() + minutes * 60000)]);
  for (let i = 0; i < 40; i++) {
    const q = { ...quote(), quoteId: randomUUID() };
    const searching = Trip.create(randomUUID(), q, rider.sub, now).search(now).trip;
    const cancelled = searching.cancel(rider, 'test', searching.snapshot().version, now).trip.snapshot();
    await store.transaction(async tx => { await tx.saveQuote(q); await tx.saveTrip(cancelled); });
    await spread(cancelled.tripId, i);
  }
  assert.equal(await store.transaction(tx => tx.active(rider)), null);
  const q = { ...quote(), quoteId: randomUUID() };
  const open = Trip.create(randomUUID(), q, rider.sub, now).search(now).trip.snapshot();
  await store.transaction(async tx => { await tx.saveQuote(q); await tx.saveTrip(open); });
  await spread(open.tripId, 41);
  assert.equal((await store.transaction(tx => tx.active(rider)))?.tripId, open.tripId);
  // One clock step back between API replicas: a cancelled Trip sorts newest, the open one second, and is still found.
  await store.db.query(`UPDATE trips SET requested_at = $2 WHERE id = (SELECT id FROM trips WHERE rider_id=$1 AND id<>$3 ORDER BY requested_at DESC LIMIT 1)`, [rider.sub, new Date(now.getTime() + 50 * 60000), open.tripId]);
  assert.equal((await store.transaction(tx => tx.active(rider)))?.tripId, open.tripId);
  // The lookup stops after two entries of the history index instead of filtering the rider's whole history.
  await store.db.query('ANALYZE trips');
  const plan: { 'QUERY PLAN': string }[] = await store.db.query(`EXPLAIN (ANALYZE, FORMAT TEXT) SELECT data FROM trips WHERE rider_id='${rider.sub}' ORDER BY requested_at DESC, id DESC LIMIT 2`);
  const text = plan.map(r => r['QUERY PLAN']).join('\n');
  assert.match(text, /Index Scan using trips_rider_history/);
  assert.match(text, /Limit .*rows=2(\.00)? loops=1\)/);
});
test('compare-and-swap rejects outdated version without overwriting data', async () => {
  const q = quote(); const data = Trip.create(randomUUID(), q, rider.sub, now).search(now).trip.snapshot();
  await store.transaction(async tx => { await tx.saveQuote(q); await tx.saveTrip(data); });
  await assert.rejects(store.transaction(tx => tx.saveTrip(data, 0)), { code: 'VERSION_CONFLICT' });
  assert.equal((await store.transaction(tx => tx.findTrip(data.tripId)))?.status, 'SEARCHING');
});
