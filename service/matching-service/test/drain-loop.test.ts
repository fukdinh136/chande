import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DrainLoop } from '../src/application/drain-loop';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// Each run returns the next scripted result (true = more work waiting, false = idle, Error = failure).
function scripted(results: (boolean | Error)[], fallback: boolean | Error, delayMs = 0) {
  const state = { calls: 0, work: async () => { const next = results[state.calls++] ?? fallback; if (delayMs) await wait(delayMs); if (next instanceof Error) throw next; return next; } };
  return state;
}

test('runs again right away while work reports more, then rests', async () => {
  const s = scripted([true, true, false], false); const loop = new DrainLoop(s.work, 10000); loop.start();
  try { await wait(100); assert.equal(s.calls, 3); } finally { await loop.stop(); }
});

test('rests restMs after an idle run', async () => {
  const s = scripted([], false); const loop = new DrainLoop(s.work, 200); loop.start();
  try { await wait(100); assert.equal(s.calls, 1); await wait(200); assert.equal(s.calls, 2); } finally { await loop.stop(); }
});

test('a failing run reports the error and rests, even when woken meanwhile', async () => {
  const errors: unknown[] = []; const s = scripted([], new Error('broker down'), 30);
  const loop = new DrainLoop(s.work, 10000, error => errors.push(error)); loop.start();
  try { await wait(10); loop.wake(); await wait(100); assert.equal(s.calls, 1); assert.equal(errors.length, 1); } finally { await loop.stop(); }
});

test('wake cuts a rest short', async () => {
  const s = scripted([], false); const loop = new DrainLoop(s.work, 10000); loop.start();
  try { await wait(50); assert.equal(s.calls, 1); loop.wake(); await wait(50); assert.equal(s.calls, 2); } finally { await loop.stop(); }
});

test('wake during a run starts the next run right after it', async () => {
  const s = scripted([], false, 50); const loop = new DrainLoop(s.work, 10000); loop.start();
  try { await wait(10); loop.wake(); await wait(150); assert.equal(s.calls, 2); } finally { await loop.stop(); }
});

test('stop ends a chain of busy runs and later wakes do nothing', async () => {
  const s = scripted([], true); const loop = new DrainLoop(s.work, 10000); loop.start();
  await wait(20); await loop.stop(); const after = s.calls; assert.ok(after > 1);
  loop.wake(); await wait(50); assert.equal(s.calls, after);
});
