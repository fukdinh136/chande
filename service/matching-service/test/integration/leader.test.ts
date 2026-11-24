import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { LeaderElection } from '../../src/infrastructure/leader';

test('two worker processes on PostgreSQL: one leads, and the other takes over when the leader process dies', { skip: !process.env.MATCHING_TEST_DATABASE_URL }, async () => {
  const open = () => new DataSource({ type: 'postgres', url: process.env.MATCHING_TEST_DATABASE_URL!, extra: { max: 2 } }).initialize();
  const [one, two] = await Promise.all([open(), open()]);
  try {
    const a = new LeaderElection(one, 'test-purge', () => {}), b = new LeaderElection(two, 'test-purge', () => {});
    assert.equal(await a.lead(), true); assert.equal(await b.lead(), false);
    await one.destroy(); // the leader process exits without resigning; PostgreSQL drops its session lock
    assert.equal(await b.lead(), true);
    await b.resign();
  } finally { if (one.isInitialized) await one.destroy(); await two.destroy(); }
});
