import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DataSource, QueryRunner } from 'typeorm';
import { LeaderElection, type LeaderEvent } from '../src/infrastructure/leader';

/** A fake database with one advisory lock shared by every connection, like PostgreSQL. */
function fakeDb() {
  const state = { holder: null as object | null, released: 0, connections: 0, down: false };
  const db = {
    createQueryRunner() {
      const runner = { broken: false,
        async connect() { if (state.down) throw new Error('unreachable'); state.connections++; },
        async query(sql: string) {
          if (state.down || runner.broken) throw new Error('connection lost');
          if (sql.includes('pg_try_advisory_lock')) { if (state.holder && state.holder !== runner) return [{ ok: false }]; state.holder = runner; return [{ ok: true }]; }
          if (sql.includes('pg_advisory_unlock')) { if (state.holder === runner) state.holder = null; return [{ ok: true }]; }
          return [{ '?column?': 1 }];
        },
        async release() { state.released++; state.connections--; if (state.holder === runner && runner.broken) state.holder = null; } };
      return runner as unknown as QueryRunner;
    },
  } as Pick<DataSource, 'createQueryRunner'>;
  return { db, state };
}

test('one replica leads, the other skips, and leadership moves when the leader resigns', async () => {
  const { db, state } = fakeDb(), events: LeaderEvent[] = [];
  const a = new LeaderElection(db, 'purge', e => events.push(e)), b = new LeaderElection(db, 'purge', e => events.push(e));
  assert.equal(await a.lead(), true); assert.equal(await b.lead(), false);
  assert.equal(await a.lead(), true, 'the leader keeps its lock');
  assert.equal(state.connections, 1, 'only the leader keeps a connection');
  await a.resign(); assert.equal(a.leader, false);
  assert.equal(await b.lead(), true); assert.equal(await a.lead(), false);
  assert.deepEqual(events, [{ event: 'leader_elected', job: 'purge' }, { event: 'leader_elected', job: 'purge' }]);
});

test('a leader whose connection dies stops leading, and another replica takes over', async () => {
  const { db, state } = fakeDb(), events: string[] = [];
  const a = new LeaderElection(db, 'purge', e => events.push('a:' + e.event)), b = new LeaderElection(db, 'purge', e => events.push('b:' + e.event));
  assert.equal(await a.lead(), true);
  (state.holder as { broken: boolean }).broken = true; // PostgreSQL drops the session and its lock
  assert.equal(await a.lead(), true, 'a reconnects and takes the lock again because nobody else has it');
  assert.deepEqual(events, ['a:leader_elected', 'a:leader_lost', 'a:leader_elected']);
  state.down = true;
  assert.equal(await b.lead(), false, 'an unreachable database means no leader this round');
  state.down = false; await a.resign();
  assert.equal(await b.lead(), true);
});
