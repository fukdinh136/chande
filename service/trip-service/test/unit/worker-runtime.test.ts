import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startWorker } from '../../src/bootstrap/worker-runtime';
import type { OutboxDispatcher } from '../../src/infrastructure/outbox/dispatcher';
import type { Store } from '../../src/application/ports/store';

const store = { ready: async () => true } as unknown as Store;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// Fake dispatcher: each tick returns the next claimed count (or throws when the value is an Error).
function fakeDispatcher(results: (number | Error)[], fallback: number | Error) {
  const fake = { calls: 0, lastProgress: Date.now(), async tick() { const next = results[fake.calls++] ?? fallback; if (next instanceof Error) throw next; return next; } };
  return fake;
}
const start = (dispatcher: ReturnType<typeof fakeDispatcher>, pollInterval: number) =>
  startWorker(dispatcher as unknown as OutboxDispatcher, store, { workerPort: 0, pollInterval, heartbeatMaxAge: 30000, batchSize: 5 }, '127.0.0.1');

test('full batches run back-to-back without waiting for the poll interval', async () => {
  const dispatcher = fakeDispatcher([5, 5, 2], 0);
  const worker = await start(dispatcher, 10000);
  try { await wait(100); assert.equal(dispatcher.calls, 3); } finally { await worker.stop(); }
});

test('a partial batch rests for the poll interval before the next tick', async () => {
  const dispatcher = fakeDispatcher([], 2);
  const worker = await start(dispatcher, 200);
  try {
    await wait(100); assert.equal(dispatcher.calls, 1);
    await wait(200); assert.equal(dispatcher.calls, 2);
  } finally { await worker.stop(); }
});

test('a failing tick rests for the poll interval instead of looping hot', async () => {
  const dispatcher = fakeDispatcher([], new Error('db down'));
  const worker = await start(dispatcher, 10000);
  try { await wait(100); assert.equal(dispatcher.calls, 1); assert.equal(dispatcher.lastProgress, 0); } finally { await worker.stop(); }
});

test('stop ends a chain of full batches', async () => {
  const dispatcher = fakeDispatcher([], 5);
  const worker = await start(dispatcher, 10000);
  await wait(20); await worker.stop();
  const after = dispatcher.calls; assert.ok(after > 1);
  await wait(50); assert.equal(dispatcher.calls, after);
});
