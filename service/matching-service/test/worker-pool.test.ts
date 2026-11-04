import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchingWorker } from '../src/application/worker';
import type { Repository } from '../src/infrastructure/persistence';
import type { MatchDriver } from '../src/application/match';
import type { AssignDriver } from '../src/application/decisions';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// In-memory stand-ins: `due` is the queue of trip ids the claim query would return; `durations` sets how long each job runs.
function setup(due: string[], durations: Record<string, number> = {}, opts: { workers?: number; scanMs?: number; claimError?: boolean } = {}) {
  const state = { claims: 0, inFlight: 0, maxInFlight: 0, done: [] as string[], errors: 0 };
  const repo = {
    claim: async (limit: number) => { state.claims++; if (opts.claimError) throw new Error('db down'); return due.splice(0, limit).map(trip_id => ({ trip_id, lease_id: 'lease-' + trip_id })); },
    getSearch: async () => ({ status: 'SEARCHING' }), finishLease: async () => {}, transaction: async () => {}, db: { query: async () => [] },
  } as unknown as Repository;
  const match = { execute: async (tripId: string) => { state.inFlight++; state.maxInFlight = Math.max(state.maxInFlight, state.inFlight); await wait(durations[tripId] ?? 10); state.inFlight--; state.done.push(tripId); } } as unknown as MatchDriver;
  const worker = new MatchingWorker(repo, match, {} as AssignDriver, { workers: opts.workers ?? 2, leaseMs: 60000, scanMs: opts.scanMs ?? 10000 }, () => { state.errors++; });
  return { state, worker };
}

test('a slow job does not hold back the jobs queued behind it', async () => {
  const { state, worker } = setup(['slow', 'a', 'b', 'c', 'd'], { slow: 400 }); worker.start();
  try { await wait(150); assert.deepEqual([...state.done].sort(), ['a', 'b', 'c', 'd']); assert.equal(worker.running, 1); } finally { await worker.stop(); }
  assert.ok(state.done.includes('slow'));
});

test('never runs more jobs at once than WORKER_CONCURRENCY and drains the queue', async () => {
  const jobs = Array.from({ length: 20 }, (_, i) => 'trip-' + i); const { state, worker } = setup(jobs, {}, { workers: 3 }); worker.start();
  try { await wait(250); assert.equal(state.done.length, 20); assert.equal(state.maxInFlight, 3); } finally { await worker.stop(); }
});

test('rests scanMs when nothing is due, and wake claims right away', async () => {
  const due: string[] = []; const { state, worker } = setup(due); worker.start();
  try {
    await wait(50); assert.equal(state.claims, 1);
    // wake claims 'late' at once; when it finishes the freed slot claims again (nothing due), then the worker rests.
    due.push('late'); worker.wake(); await wait(50); assert.deepEqual(state.done, ['late']); assert.equal(state.claims, 3);
    await wait(100); assert.equal(state.claims, 3);
  } finally { await worker.stop(); }
});

test('a failing claim is reported and rests instead of looping hot', async () => {
  const { state, worker } = setup([], {}, { claimError: true }); worker.start();
  try { await wait(100); assert.equal(state.claims, 1); assert.equal(state.errors, 1); } finally { await worker.stop(); }
});

test('stop waits for running jobs and claims nothing more', async () => {
  const { state, worker } = setup(['a', 'b', 'c'], { a: 80, b: 80, c: 80 }); worker.start();
  await wait(10); await worker.stop(); assert.deepEqual([...state.done].sort(), ['a', 'b']);
  await wait(100); assert.ok(!state.done.includes('c'));
});
