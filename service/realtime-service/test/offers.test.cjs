const { test } = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const { OfferConsumer, canDeliver } = require('../dist/infrastructure/offers/consumer');
test('consumer delivers only authoritative version to authenticated driver room; duplicate/revoked/expired offers', async () => {
  const driverId = randomUUID(), offerId = randomUUID(), tripId = randomUUID();
  let current = { driverId, offerId, tripId, version: 2, status: 'REVOKED', expiresAt: new Date(Date.now()+20000).toISOString(), pickup: {lat:21,lng:105}, destination:{lat:21,lng:105}, vehicleType:'CAR_4', fare:{currency:'VND',amount:'12000'} };
  const emitted = [], cached = new Map(); let ack = 0, dead = 0;
  const redis = { eval: async (_script, _count, key, version, data) => { if ((cached.get(key)?.version ?? 0) >= version) return 0; cached.set(key, JSON.parse(data)); return 1; } };
  const consumer = new OfferConsumer(redis, { rabbitUrl:'', matchingUrl:'', matchingToken:'' }); consumer.lookup = async () => current;
  consumer.attach({ to: room => ({ emit: (name, payload) => emitted.push({room,name,payload}) }) });
  const channel = { ack: () => ack++, nack: () => dead++ };
  const event = { eventId:randomUUID(), type:'DRIVER_TRIP_OFFER', offerId,tripId,driverId,version:1,status:'PENDING',expiresAt:current.expiresAt };
  const message = { content:Buffer.from(JSON.stringify(event)),properties:{} };
  await consumer.consume(message, channel); await consumer.consume(message, channel);
  assert.equal(ack,2); assert.equal(emitted.length,1); assert.equal(emitted[0].room,'driver:'+driverId); assert.equal(emitted[0].name,'driver.trip.offer.updated'); assert.equal(emitted[0].payload.data.status,'REVOKED');
  current = {...current, version:3,status:'PENDING',expiresAt:new Date(Date.now()-1).toISOString()}; await consumer.consume(message,channel); assert.equal(emitted.length,1); assert.equal(canDeliver(current,Date.now()),false);
  await consumer.consume({content:Buffer.from('broken'),properties:{}},channel); assert.equal(dead,1);
  await consumer.replay(driverId); assert.equal(emitted.length,1);
});
