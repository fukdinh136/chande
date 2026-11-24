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
test('offer version guard expires after an hour by default, or the configured lifetime', async () => {
  const offer = { driverId: randomUUID(), offerId: randomUUID(), tripId: randomUUID(), version: 1, status: 'ASSIGNED', expiresAt: new Date(Date.now()+20000).toISOString(), pickup: {lat:21,lng:105}, destination:{lat:21,lng:105}, vehicleType:'CAR_4', fare:{currency:'VND',amount:'12000'} };
  const message = { content: Buffer.from(JSON.stringify({ eventId: randomUUID(), type: 'DRIVER_TRIP_OFFER_UPDATED', offerId: offer.offerId, tripId: offer.tripId, driverId: offer.driverId, version: 1, status: 'ASSIGNED', expiresAt: offer.expiresAt })), properties: {} };
  const ttlFor = async config => {
    let ttl; const consumer = new OfferConsumer({ eval: async (script, _count, _key, _version, _data, seconds) => { assert.match(script, /'EX',tonumber\(ARGV\[3\]\)/); ttl = seconds; return 1; } }, { rabbitUrl: '', matchingUrl: '', matchingToken: '', ...config });
    consumer.lookup = async () => offer; consumer.attach({ to: () => ({ emit: () => {} }) });
    await consumer.consume(message, { ack: () => {}, nack: () => assert.fail('must not nack') });
    return ttl;
  };
  assert.equal(await ttlFor({}), 3600);
  assert.equal(await ttlFor({ offerCacheTtlSeconds: 86400 }), 86400);
  const { loadConfig } = require('../dist/bootstrap/config/configuration');
  const base = { REDIS_URL: 'redis://redis:6379', MATCHING_LOCATION_TOKEN: 'x'.repeat(32), AUTH_JWKS_URL: 'http://user:3011/jwks', AUTH_JWT_ISSUER: 'issuer' };
  assert.equal(loadConfig(base).offerCacheTtlSeconds, 3600);
  assert.throws(() => loadConfig({ ...base, OFFER_CACHE_TTL_SECONDS: '604801' }), /OFFER_CACHE_TTL_SECONDS/);
});
test('Redis/dependency error retries with same deadline; exhausted retry goes to DLQ', async () => {
  const event={eventId:randomUUID(),offerId:randomUUID(),tripId:randomUUID(),driverId:randomUUID(),version:1,status:'PENDING',type:'DRIVER_TRIP_OFFER',expiresAt:new Date(Date.now()+20000).toISOString()};
  let ack=0,dead=0,queued;
  const channel={ack:()=>ack++,nack:()=>dead++,sendToQueue:(queue,content,properties,confirm)=>{queued={queue,event:JSON.parse(content.toString()),properties};confirm(null)}};
  const consumer=new OfferConsumer({eval:async()=>{throw new Error('Redis offline')}},{rabbitUrl:'',matchingUrl:'',matchingToken:''}); consumer.attach({to:()=>({emit:()=>assert.fail('must not emit')})}); consumer.lookup=async()=>event;
  await consumer.consume({content:Buffer.from(JSON.stringify(event)),properties:{messageId:event.eventId}},channel);
  assert.equal(ack,1);assert.equal(queued.queue,'driver.offers.retry.1000');assert.equal(queued.event.expiresAt,event.expiresAt);assert.equal(queued.properties.messageId,event.eventId);
  await consumer.consume({content:Buffer.from(JSON.stringify(event)),properties:{headers:{'x-offer-retries':10}}},channel);assert.equal(dead,1);
});
test('offer lookup stops calling a failing Matching until the breaker lets a trial through', async () => {
  const { createServer } = require('node:http'), { CircuitBreaker } = require('../dist/infrastructure/circuit-breaker');
  let hits = 0, status = 500; const clock = { t: 0 };
  const server = createServer((req, res) => { hits++; res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(status === 404 ? '{}' : ''); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const consumer = new OfferConsumer({}, { rabbitUrl: '', matchingUrl: `http://127.0.0.1:${server.address().port}`, matchingToken: 't' }, new CircuitBreaker('matching', { failureThreshold: 2, openMs: 5000, now: () => clock.t, onChange: () => {} }));
    for (let i = 0; i < 3; i++) await assert.rejects(consumer.lookup('/offer'), /MATCHING_UNAVAILABLE/);
    assert.equal(hits, 2, 'the open breaker does not call Matching');
    clock.t += 5000; status = 404;
    assert.equal(await consumer.lookup('/offer'), null);
    assert.equal(consumer.breaker.state, 'closed'); assert.equal(hits, 3);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
