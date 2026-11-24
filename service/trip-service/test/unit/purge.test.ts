import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPurge } from '../../src/bootstrap/purge';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// Fake purge: each call returns the next deleted count (or throws when the value is an Error).
function fakePurge(results: (number | Error)[], fallback: number) {
  const fake = { calls: 0, async run() { const next = results[fake.calls++] ?? fallback; if (next instanceof Error) throw next; return next; } };
  return fake;
}

test('full batches run back-to-back, then the purge rests until the next interval', async () => {
  const purge = fakePurge([3, 3, 1], 0); const events: Record<string, unknown>[] = [];
  const stop = startPurge(() => purge.run(), 3, 10000, e => events.push(e));
  try { await wait(50); assert.equal(purge.calls, 3); assert.deepEqual(events, [{ event: 'outbox_purged', rows: 7 }]); } finally { await stop(); }
});

test('a failed run is reported and retried on the next interval, not in a hot loop', async () => {
  const purge = fakePurge([new Error('db down')], 0); const events: Record<string, unknown>[] = [];
  const stop = startPurge(() => purge.run(), 3, 150, e => events.push(e));
  try {
    await wait(50); assert.equal(purge.calls, 1); assert.deepEqual(events, [{ event: 'outbox_purge_failed', rows: 0 }]);
    await wait(150); assert.equal(purge.calls, 2);
  } finally { await stop(); }
});

test('stop waits for the running batch and schedules nothing more', async () => {
  let calls = 0;
  const stop = startPurge(async () => { calls++; await wait(60); return 0; }, 3, 10);
  await wait(20); await stop(); assert.equal(calls, 1);
  await wait(60); assert.equal(calls, 1);
});
