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
