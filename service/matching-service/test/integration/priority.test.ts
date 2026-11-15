import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { source, Repository } from '../../src/infrastructure/persistence';
import type { Search } from '../../src/domain/models';

test('claim takes assignments first, then the trips booked earliest, before retried or newer searches', { skip: !process.env.MATCHING_TEST_DATABASE_URL }, async () => {
  const db = source(process.env.MATCHING_TEST_DATABASE_URL!); await db.initialize(); await db.runMigrations(); const repo = new Repository(db);
  try {
    // Park every other due job so only this test's rows compete for the claim.
    await db.query(`UPDATE matching_searches SET due_at=clock_timestamp()+interval '1 hour' WHERE status IN ('SEARCHING','ASSIGNMENT_PENDING')`);
    const now = Date.now();
    const search = (status: Search['status'], bookedAgoMs: number) => ({ tripId: randomUUID(), status, command: { occurredAt: new Date(now - bookedAgoMs).toISOString() }, offerId: null, attempts: 0 } as unknown as Search);
    const fresh = search('SEARCHING', 1000), retried = search('SEARCHING', 60000), oldest = search('SEARCHING', 120000), assigning = search('ASSIGNMENT_PENDING', 500);
    // `fresh` has been due longest; without priorities the claim would take it first.
    for (const [s, dueAgoMs] of [[fresh, 9000], [retried, 100], [oldest, 50], [assigning, 10]] as const)
      await repo.transaction(tx => tx.saveSearch(s, -dueAgoMs));
    const ids = (rows: { trip_id: string }[]) => rows.map(c => c.trip_id).sort();
    assert.deepEqual(ids(await repo.claim(3, 60000)), [assigning.tripId, oldest.tripId, retried.tripId].sort());
    assert.deepEqual((await repo.claim(3, 60000)).map(c => c.trip_id), [fresh.tripId]);
  } finally {
    await db.query(`DELETE FROM matching_searches WHERE data->'command'->>'occurredAt' IS NOT NULL AND data->'command'->>'commandId' IS NULL`);
    await db.destroy();
  }
});
