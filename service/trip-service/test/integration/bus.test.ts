import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from 'amqplib';
import { EXCHANGE, TripEventBus } from '../../src/infrastructure/outbox/bus';
import { TransportError } from '../../src/infrastructure/clients/http';
const url = process.env.TRIP_TEST_RABBIT_URL;
// ADR-0002: an event reaches every bound queue with its type as routing key; with no queue bound it stays in the outbox.
test('trip events are published to trip.events and kept when nobody listens', { skip: !url }, async () => {
  const bus = new TripEventBus(url!), model = await connect(url!), channel = await model.createChannel();
  try {
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    const { queue } = await channel.assertQueue('', { exclusive: true }); await channel.bindQueue(queue, EXCHANGE, 'trip.#');
    const event = { schemaVersion: 1, eventId: randomUUID(), type: 'trip.cancelled', tripId: randomUUID(), tripVersion: 3, occurredAt: new Date().toISOString(), data: { status: 'CANCELLED' } };
    await bus.publish(event);
    const message = await channel.get(queue, { noAck: true }); assert.ok(message);
    assert.deepEqual(JSON.parse(message.content.toString()), event);
    assert.equal(message.fields.routingKey, 'trip.cancelled'); assert.equal(message.properties.messageId, event.eventId); assert.equal(message.properties.deliveryMode, 2);
    // No queue is bound for this routing key: the broker returns the message and the delivery is retried later.
    await assert.rejects(bus.publish({ ...event, eventId: randomUUID(), type: 'unbound.' + randomUUID() }), (e: unknown) => e instanceof TransportError && e.retryable && e.reason === 'UNROUTABLE');
    await assert.rejects(new TripEventBus('amqp://nobody:nobody@127.0.0.1:1').publish(event), (e: unknown) => e instanceof TransportError && e.retryable);
  } finally { await bus.close(); await model.close(); }
});
