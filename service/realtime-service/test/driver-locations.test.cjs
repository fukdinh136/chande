const { test } = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const { ListDriverLocations } = require('../dist/application/use-cases/list-driver-locations');
const { LocationPolicy } = require('../dist/domain/policies/location.policy');
const { requireServiceCredential } = require('../dist/presentation/http/guards/service-credential');
const { RedisLocationRepository } = require('../dist/infrastructure/redis/redis-location.repository');
const policy = new LocationPolicy(30000, 5000, 100);
const at = (ms) => new Date(Date.now() + ms).toISOString();
const row = (distanceMeters, recordedAt = at(-1000)) => ({ driverId: randomUUID(), latitude: 21, longitude: 105.8, accuracy: 5, recordedAt, receivedAt: recordedAt, distanceMeters });

test('driver-locations: passes radius and limit to the store and returns fresh raw locations', async () => {
  let seen;
  const stale = row(10, at(-31000)), near = row(20), far = row(900);
  const use = new ListDriverLocations({ nearest: async (q) => { seen = q; return { items: [stale, near, far], more: false }; } }, policy);
  const result = await use.execute({ latitude: 21, longitude: 105.8 });
  assert.deepEqual(seen, { latitude: 21, longitude: 105.8, radiusMeters: 2000, limit: 50, offset: 0 });
  assert.equal(result.radiusMeters, 2000);
  assert.deepEqual(result.drivers.map(d => d.driverId), [near.driverId, far.driverId]);
  assert.deepEqual(Object.keys(result.drivers[0]).sort(), ['distanceMeters', 'driverId', 'latitude', 'longitude', 'recordedAt']);
  assert.equal(result.nextOffset, null);
  await use.execute({ latitude: 21, longitude: 105.8, radiusMeters: 1500, limit: 200 });
  assert.deepEqual(seen, { latitude: 21, longitude: 105.8, radiusMeters: 1500, limit: 200, offset: 0 });
});

test('driver-locations: pages down the distance ranking until the radius or the offset cap runs out', async () => {
  let seen;
  const use = new ListDriverLocations({ nearest: async (q) => { seen = q; return { items: [row(10, at(-31000))], more: true }; } }, policy);
  // A page whose drivers are all stale still points at the next one.
  const first = await use.execute({ latitude: 21, longitude: 105.8, limit: 200, offset: 200 });
  assert.deepEqual(seen, { latitude: 21, longitude: 105.8, radiusMeters: 2000, limit: 200, offset: 200 });
  assert.deepEqual(first.drivers, []);
  assert.equal(first.nextOffset, 400);
  // The next page would start past 4800, so there is none even though Redis has more.
  assert.equal((await use.execute({ latitude: 21, longitude: 105.8, limit: 200, offset: 4700 })).nextOffset, null);
  assert.equal((await use.execute({ latitude: 21, longitude: 105.8, limit: 200, offset: 4600 })).nextOffset, 4800);
});

test('driver-locations: rejects out-of-range input before reading', async () => {
  const use = new ListDriverLocations({ nearest: async () => assert.fail('must not read') }, policy);
  for (const input of [{ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }, { latitude: 0, longitude: 0, limit: 201 }, { latitude: 0, longitude: 0, limit: 0 }, { latitude: 0, longitude: 0, radiusMeters: 2001 }, { latitude: 0, longitude: 0, offset: -1 }, { latitude: 0, longitude: 0, offset: 4801 }, { latitude: 0, longitude: 0, offset: 1.5 }, { latitude: 0, longitude: 0, limit: 1.5 }])
    await assert.rejects(use.execute(input), (e) => e.code === 'INVALID_REQUEST');
});

test('service credential: empty configuration rejects everyone; the right token passes', () => {
  const request = (token) => ({ header: () => token });
  assert.throws(() => requireServiceCredential(request(''), ''), (e) => e.code === 'INVALID_SERVICE_CREDENTIAL');
  assert.throws(() => requireServiceCredential(request('x'.repeat(40)), ''), (e) => e.code === 'INVALID_SERVICE_CREDENTIAL');
  assert.throws(() => requireServiceCredential(request('y'.repeat(40)), 'x'.repeat(40)), (e) => e.code === 'INVALID_SERVICE_CREDENTIAL');
  requireServiceCredential(request('x'.repeat(40)), 'x'.repeat(40));
});

// Needs a disposable Redis: REALTIME_TEST_REDIS_URL=redis://127.0.0.1:16379/15
test('Redis FIND_NEAREST returns at most `limit` fresh locations from `offset`, closest first', { skip: !process.env.REALTIME_TEST_REDIS_URL }, async () => {
  const Redis = require('ioredis');
  const redis = new Redis(process.env.REALTIME_TEST_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await redis.connect();
  try {
    await redis.del(...['geo', 'expiry', 'meta', 'order', 'order-expiry'].map(name => `realtime:{gps}:${name}`));
    const repo = new RedisLocationRepository(redis, 30000, 5000, 86400000, 1000, 500);
    const ids = [];
    for (let i = 0; i < 30; i++) { const id = randomUUID(); ids.push(id); await repo.update(id, { latitude: 21 + i * 0.0005, longitude: 105.8, accuracy: 5, recordedAt: at(-100) }); }
    const first = await repo.nearest({ latitude: 21, longitude: 105.8, radiusMeters: 2000, limit: 10, offset: 0 });
    assert.deepEqual(first.items.map(n => n.driverId), ids.slice(0, 10));
    assert.ok(first.items.every((n, i) => i === 0 || n.distanceMeters >= first.items[i - 1].distanceMeters));
    assert.equal(first.more, true);
    assert.equal((await repo.nearest({ latitude: 21, longitude: 105.8, radiusMeters: 2000, limit: 25, offset: 0 })).items.length, 25);
    // Pages continue the same ranking without overlap; the last one says there is nothing more.
    const second = await repo.nearest({ latitude: 21, longitude: 105.8, radiusMeters: 2000, limit: 10, offset: 10 });
    assert.deepEqual(second.items.map(n => n.driverId), ids.slice(10, 20));
    const last = await repo.nearest({ latitude: 21, longitude: 105.8, radiusMeters: 2000, limit: 10, offset: 20 });
    assert.deepEqual(last.items.map(n => n.driverId), ids.slice(20, 30));
    assert.equal(last.more, false);
    assert.deepEqual(await repo.nearest({ latitude: 21, longitude: 105.8, radiusMeters: 2000, limit: 10, offset: 30 }), { items: [], more: false });
  } finally {
    await redis.del(...['geo', 'expiry', 'meta', 'order', 'order-expiry'].map(name => `realtime:{gps}:${name}`));
    redis.disconnect();
  }
});
