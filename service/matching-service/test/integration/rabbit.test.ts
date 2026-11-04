import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from 'amqplib';
import { source, Repository } from '../../src/infrastructure/persistence';
import { OfferPublisher, topology } from '../../src/infrastructure/publisher';
test('RabbitMQ publisher marks outbox only after confirm and preserves message ID', { skip: !process.env.MATCHING_TEST_DATABASE_URL || !process.env.MATCHING_TEST_RABBIT_URL }, async () => {
  const db = source(process.env.MATCHING_TEST_DATABASE_URL!); await db.initialize(); await db.runMigrations();
  const publisher = new OfferPublisher(new Repository(db), process.env.MATCHING_TEST_RABBIT_URL!); const model = await connect(process.env.MATCHING_TEST_RABBIT_URL!), channel = await model.createConfirmChannel(); await topology(channel);
  const id = randomUUID();
  try { await db.query('INSERT INTO matching_outbox(id,payload) VALUES($1,$2)', [id, { eventId: id }]);
    for (let i = 0; i < 20; i++) { await publisher.tick(); const rows = await db.query('SELECT published_at FROM matching_outbox WHERE id=$1', [id]); if (rows[0].published_at) break; }
    const rows = await db.query('SELECT published_at FROM matching_outbox WHERE id=$1', [id]); assert.ok(rows[0].published_at);
    let found = false; for (let i = 0; i < 100; i++) { const message = await channel.get('driver.offers'); if (!message) break; if (message.properties.messageId === id) { found = true; assert.equal(message.properties.deliveryMode,2); } channel.ack(message); } assert.ok(found);
  } finally { await publisher.close(); await model.close(); await db.destroy(); }
});
test('publisher drains a backlog past the old 10-per-round cap in due_at order', { skip: !process.env.MATCHING_TEST_DATABASE_URL || !process.env.MATCHING_TEST_RABBIT_URL }, async () => {
  const db = source(process.env.MATCHING_TEST_DATABASE_URL!); await db.initialize(); await db.runMigrations();
  const publisher = new OfferPublisher(new Repository(db), process.env.MATCHING_TEST_RABBIT_URL!, 100); const model = await connect(process.env.MATCHING_TEST_RABBIT_URL!), channel = await model.createConfirmChannel(); await topology(channel);
  try {
    await db.query('UPDATE matching_outbox SET published_at=clock_timestamp() WHERE published_at IS NULL'); await channel.purgeQueue('driver.offers');
    const ids = Array.from({ length: 250 }, () => randomUUID());
    // Insert in reverse so table order differs from due_at order; ids[0] is due first. due_at comes from one fixed
    // base (1 s apart, all in the past), so a slow machine cannot reorder rows by taking long between inserts.
    const base = Date.now() - 3600000;
    for (let i = ids.length - 1; i >= 0; i--) await db.query('INSERT INTO matching_outbox(id,payload,due_at) VALUES($1,$2,$3)', [ids[i], { eventId: ids[i] }, new Date(base + i * 1000)]);
    assert.deepEqual([await publisher.tick(), await publisher.tick(), await publisher.tick()], [true, true, false]);
    const pending = await db.query('SELECT count(*)::int AS n FROM matching_outbox WHERE id = ANY($1) AND published_at IS NULL', [ids]); assert.equal(pending[0].n, 0);
    const received: string[] = []; for (let i = 0; i < 300; i++) { const message = await channel.get('driver.offers'); if (!message) break; received.push(String(message.properties.messageId)); channel.ack(message); }
    assert.deepEqual(received, ids);
  } finally { await publisher.close(); await model.close(); await db.destroy(); }
});
