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
  const use = new ListDriverLocations({ nearest: async (q) => { seen = q; return [stale, near, far]; } }, policy);
  const result = await use.execute({ latitude: 21, longitude: 105.8 });
  assert.deepEqual(seen, { latitude: 21, longitude: 105.8, radiusMeters: 2000, limit: 50 });
  assert.equal(result.radiusMeters, 2000);
  assert.deepEqual(result.drivers.map(d => d.driverId), [near.driverId, far.driverId]);
  assert.deepEqual(Object.keys(result.drivers[0]).sort(), ['distanceMeters', 'driverId', 'latitude', 'longitude', 'recordedAt']);
  await use.execute({ latitude: 21, longitude: 105.8, radiusMeters: 1500, limit: 200 });
  assert.deepEqual(seen, { latitude: 21, longitude: 105.8, radiusMeters: 1500, limit: 200 });
});

test('driver-locations: rejects out-of-range input before reading', async () => {
  const use = new ListDriverLocations({ nearest: async () => assert.fail('must not read') }, policy);
  for (const input of [{ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }, { latitude: 0, longitude: 0, limit: 201 }, { latitude: 0, longitude: 0, limit: 0 }, { latitude: 0, longitude: 0, radiusMeters: 2001 }, { latitude: 0, longitude: 0, limit: 1.5 }])
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
test('Redis FIND_NEAREST returns at most `limit` fresh locations, closest first', { skip: !process.env.REALTIME_TEST_REDIS_URL }, async () => {
  const Redis = require('ioredis');
  const redis = new Redis(process.env.REALTIME_TEST_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await redis.connect();
  try {
    await redis.del(...['geo', 'expiry', 'meta', 'order', 'order-expiry'].map(name => `realtime:{gps}:${name}`));
    const repo = new RedisLocationRepository(redis, 30000, 5000, 86400000, 1000, 500);
    const ids = [];
    for (let i = 0; i < 30; i++) { const id = randomUUID(); ids.push(id); await repo.update(id, { latitude: 21 + i * 0.0005, longitude: 105.8, accuracy: 5, recordedAt: at(-100) }); }
    const nearest = await repo.nearest({ latitude: 21, longitude: 105.8, radiusMeters: 2000, limit: 10 });
    assert.deepEqual(nearest.map(n => n.driverId), ids.slice(0, 10));
    assert.ok(nearest.every((n, i) => i === 0 || n.distanceMeters >= nearest[i - 1].distanceMeters));
    assert.equal((await repo.nearest({ latitude: 21, longitude: 105.8, radiusMeters: 2000, limit: 25 })).length, 25);
  } finally {
    await redis.del(...['geo', 'expiry', 'meta', 'order', 'order-expiry'].map(name => `realtime:{gps}:${name}`));
    redis.disconnect();
  }
});
