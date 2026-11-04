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
test('publisher claim on matching_outbox can use the matching_outbox_pending partial index', { skip: !process.env.MATCHING_TEST_DATABASE_URL }, async () => {
  const db = source(process.env.MATCHING_TEST_DATABASE_URL!); await db.initialize(); await db.runMigrations();
  try {
    // Same predicate and order as the claim in publisher.ts. With seq scans disabled the planner must pick a usable index.
    const plan: { 'QUERY PLAN': string }[] = await db.transaction(async m => { await m.query('SET LOCAL enable_seqscan = off'); return m.query("EXPLAIN SELECT id FROM matching_outbox WHERE published_at IS NULL AND due_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY due_at LIMIT 1 FOR UPDATE SKIP LOCKED"); });
    assert.match(plan.map(r => r['QUERY PLAN']).join('\n'), /matching_outbox_pending/);
  } finally { await db.destroy(); }
});
test('purgePublished removes only messages published before the retention window', { skip: !process.env.MATCHING_TEST_DATABASE_URL }, async () => {
  const db = source(process.env.MATCHING_TEST_DATABASE_URL!); await db.initialize(); await db.runMigrations(); const repo = new Repository(db);
  const old = randomUUID(), recent = randomUUID(), pending = randomUUID(), older = randomUUID();
  try {
    await db.query(`INSERT INTO matching_outbox(id,payload,published_at) VALUES ($1,'{}',clock_timestamp()-interval '3 days'),($2,'{}',clock_timestamp()-interval '2 days'),($3,'{}',clock_timestamp()),($4,'{}',NULL)`, [older, old, recent, pending]);
    // Other tests share this database, so check only this test's rows.
    const mine = async () => ((await db.query('SELECT id::text FROM matching_outbox WHERE id = ANY($1::uuid[])', [[old, recent, pending, older]])) as { id: string }[]).map(r => r.id).sort();
    assert.equal(await repo.purgePublished(86400000, 1), 1);
    while (await repo.purgePublished(86400000, 1000) > 0) { /* drain everything past retention */ }
    assert.deepEqual(await mine(), [recent, pending].sort());
  } finally { await db.destroy(); }
});
