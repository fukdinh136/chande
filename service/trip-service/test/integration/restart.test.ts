import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase, clearDatabase } from '../database';
import { quote, rider, now } from '../fixtures';
import { CreateTrip } from '../../src/application/use-cases/create';
import { PgOutbox } from '../../src/infrastructure/outbox/repository';
import { OutboxDispatcher } from '../../src/infrastructure/outbox/dispatcher';
import { TransportError } from '../../src/infrastructure/clients/http';
import { startWorker } from '../../src/bootstrap/worker-runtime';
test('worker restart resumes persisted deliveries and receipts survive connection restart', async () => {
  let store = await testDatabase(); await clearDatabase(store);
  try {
    await store.transaction(tx => tx.saveQuote(quote())); const key = randomUUID(); const runtime = { now: () => now, id: randomUUID };
    const original = await new CreateTrip(store, runtime).execute(rider, quote().quoteId, key);
    const repository = new PgOutbox(store.db); const claimed = await repository.claim(randomUUID(), 20, 1000); assert.equal(claimed.length, 3);
    await store.db.destroy(); store = await testDatabase();
    await store.db.query("UPDATE outbox_deliveries SET lease_until=now()-interval '1 second' WHERE status='processing'");
    const replay = await new CreateTrip(store, runtime).execute(rider, quote().quoteId, key); assert.equal(replay.replayed, true); assert.deepEqual(replay.value, original.value);
    const received: string[] = [];
    const dispatcher = new OutboxDispatcher(new PgOutbox(store.db), { send: async delivery => { received.push(delivery.id); } }, { batchSize: 20, concurrency: 3, leaseMs: 1000, retryBase: 1, retryMax: 10 });
    const worker = await startWorker(dispatcher, store, { workerPort: 0, pollInterval: 10000, heartbeatMaxAge: 30000 }, '127.0.0.1');
    try { await worker.stop(); assert.equal(received.length, 3); const pending: { count: string }[] = await store.db.query("SELECT count(*) FROM outbox_deliveries WHERE status<>'delivered'"); assert.equal(pending[0]?.count, '0'); }
    finally { await worker.stop(); }
  } finally { await store.db.destroy(); }
});
test('worker probes reflect heartbeat freshness independently of delivery errors', async () => {
  const store = await testDatabase(); await clearDatabase(store);
  const dispatcher = new OutboxDispatcher(new PgOutbox(store.db), { send: async () => { throw new TransportError(true, 'HTTP_503'); } }, { batchSize: 20, concurrency: 1, leaseMs: 1000, retryBase: 1, retryMax: 10 });
  const worker = await startWorker(dispatcher, store, { workerPort: 0, pollInterval: 10000, heartbeatMaxAge: 30000 }, '127.0.0.1');
  try {
    const address = worker.server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(base + '/health/live')).status, 200);
    await dispatcher.tick(); assert.equal((await fetch(base + '/health/ready')).status, 200);
    dispatcher.lastProgress = 0; assert.equal((await fetch(base + '/health/ready')).status, 503);
  } finally { await worker.stop(); await store.db.destroy(); }
});
