import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { source, Repository } from '../../src/infrastructure/persistence';
import { Commands } from '../../src/application/commands';
import type { Command } from '../../src/domain/models';
test('PostgreSQL receipt replay/conflict, terminal marker and lease survive reconnect', { skip: !process.env.MATCHING_TEST_DATABASE_URL }, async () => {
  const db = source(process.env.MATCHING_TEST_DATABASE_URL!); await db.initialize(); await db.runMigrations();
  const repo = new Repository(db), id = randomUUID();
  try {
    const call = (input: unknown) => repo.transaction(tx => tx.receipt('test:' + id, input, async () => { await tx.saveSearch({ tripId: id, status: 'CANCELLED', command: null, offerId: null, attempts: 0 }); return { accepted: true }; }));
    assert.deepEqual(await Promise.all([call({ a: 1 }), call({ a: 1 })]), [{ accepted: true }, { accepted: true }]);
    await assert.rejects(call({ a: 2 }), /IDEMPOTENCY_CONFLICT/);
    assert.equal((await repo.getSearch(id))?.status, 'CANCELLED');
    assert.ok(!(await repo.claim(100, 1000)).some(c => c.trip_id === id));
    const active = randomUUID(); await repo.transaction(tx => tx.saveSearch({ tripId: active, status: 'SEARCHING', command: null, offerId: null, attempts: 0 }));
    const claims = await repo.claim(100, 1000); const claimed = claims.find(c => c.trip_id === active); assert.ok(claimed?.lease_id);
    assert.ok(!(await repo.claim(100, 1000)).some(c => c.trip_id === active)); await repo.finishLease(active, claimed.lease_id);
    const commands = new Commands(repo);
    await commands.search({ commandId: randomUUID(), tripId: id } as Command);
    assert.equal((await repo.getSearch(id))?.status, 'CANCELLED');
    await db.destroy(); await db.initialize(); assert.equal((await repo.getSearch(id))?.status, 'CANCELLED');
  } finally { await db.destroy(); }
});
