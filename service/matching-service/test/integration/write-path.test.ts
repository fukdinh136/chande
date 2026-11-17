import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { source, Repository } from '../../src/infrastructure/persistence';
import type { Search } from '../../src/domain/models';

test('every pooled connection has lock_timeout 5 s, and claim reports the status it leased', { skip: !process.env.MATCHING_TEST_DATABASE_URL }, async () => {
  const db = source(process.env.MATCHING_TEST_DATABASE_URL!, 3); await db.initialize(); await db.runMigrations(); const repo = new Repository(db);
  try {
    // Several connections at once: the setting must not depend on a statement run inside each transaction.
    const shown = await Promise.all([1, 2, 3].map(() => repo.transaction(tx => tx.db.query('SHOW lock_timeout') as Promise<{ lock_timeout: string }[]>)));
    assert.deepEqual(shown.map(rows => rows[0]!.lock_timeout), ['5s', '5s', '5s']);
    await db.query(`UPDATE matching_searches SET due_at=clock_timestamp()+interval '1 hour' WHERE status IN ('SEARCHING','ASSIGNMENT_PENDING')`);
    const search = (status: Search['status']) => ({ tripId: randomUUID(), status, command: { occurredAt: new Date().toISOString() }, offerId: null, attempts: 0 } as unknown as Search);
    const searching = search('SEARCHING'), assigning = search('ASSIGNMENT_PENDING');
    for (const s of [searching, assigning]) await repo.transaction(tx => tx.saveSearch(s, -10));
    const claims = await repo.claim(10, 60000);
    assert.deepEqual(Object.fromEntries(claims.map(c => [c.trip_id, c.status])), { [searching.tripId]: 'SEARCHING', [assigning.tripId]: 'ASSIGNMENT_PENDING' });
    assert.ok(claims.every(c => c.lease_id));
    assert.deepEqual(await repo.claim(10, 60000), [], 'a leased job is not claimed twice');
  } finally { await db.query(`DELETE FROM matching_searches WHERE data->'command'->>'commandId' IS NULL AND data->'command'->>'occurredAt' IS NOT NULL`); await db.destroy(); }
});
