const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  Redis = require("ioredis");
const { RedisState } = require("../../src/infrastructure/redis/redis-state");
const url = process.env.DRIVER_TEST_REDIS_URL;
const { storageTarget } = require("../helpers/storage-target.cjs");
test(
  "Redis Lua preserves BUSY/selection, clears inactive selection, and never invents AVAILABLE",
  { skip: !url },
  async () => {
    storageTarget("redis", url);
    const redis = new Redis(url, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      }),
      id = randomUUID(),
      vehicleId = randomUUID(),
      key = "driver:" + id + ":state",
      desired = "driver:" + id + ":availability";
    await redis.connect();
    try {
      const state = new RedisState(redis, ["BIKE"]);
      await state.select(id, vehicleId);
      await state.setDesired(id, "ONLINE");
      assert.equal((await state.read(id)).realtimeStatus, "UNKNOWN");
      await redis.hset(key, "status", "BUSY");
      await state.setDesired(id, "OFFLINE");
      assert.equal((await state.read(id)).realtimeStatus, "BUSY");
      assert.equal((await state.read(id)).vehicleId, vehicleId);
      await state.clearSelection(id, randomUUID());
      assert.equal((await state.read(id)).vehicleId, vehicleId);
      await state.clearSelection(id, vehicleId);
      assert.equal((await state.read(id)).vehicleId, null);
      await redis.del(key, desired);
      assert.equal((await state.read(id)).projectedStatus, null);
      assert.equal((await state.read(id)).realtimeStatus, "UNKNOWN");
    } finally {
      await redis.del(key, desired);
      await redis.zrem("drivers:locations:last_seen", id);
      await redis.zrem("drivers:geo:BIKE", id);
      redis.disconnect();
    }
  },
);
test(
  "Redis batch read matches read(), and the conditional projection skips drivers that changed",
  { skip: !url },
  async () => {
    storageTarget("redis", url);
    const redis = new Redis(url, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1 });
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()], vehicle = randomUUID();
    const keys = ids.flatMap((id) => ["driver:" + id + ":state", "driver:" + id + ":availability"]);
    await redis.connect();
    try {
      const state = new RedisState(redis, ["BIKE"]);
      const [stays, wentOffline, switched, empty] = ids;
      for (const id of [stays, wentOffline, switched]) { await state.select(id, vehicle); await state.setDesired(id, "ONLINE"); }
      const before = await state.readMany(ids);
      assert.deepEqual(before, await Promise.all(ids.map((id) => state.read(id))));
      assert.deepEqual(before[3], { projectedStatus: null, vehicleId: null, realtimeStatus: "UNKNOWN" });
      // Changes made between the batch read and its write, as a concurrent availability update would.
      await state.setDesired(wentOffline, "OFFLINE");
      await state.select(switched, randomUUID());
      const applied = await state.projectMany(ids.map((id, i) => ({ id, status: "AVAILABLE", vehicleId: before[i].vehicleId })));
      assert.deepEqual(applied, [true, false, false, false]);
      const after = await state.readMany(ids);
      assert.equal(after[0].realtimeStatus, "AVAILABLE");
      assert.equal(after[1].realtimeStatus, "OFFLINE");
      assert.equal(after[2].realtimeStatus, "UNKNOWN");
      assert.equal(after[3].realtimeStatus, "UNKNOWN");
      // Without an expected vehicle the write is unconditional (dependency failure path).
      assert.deepEqual(await state.projectMany([{ id: empty, status: "UNKNOWN" }, { id: wentOffline, status: "UNKNOWN" }]), [true, true]);
      assert.equal((await state.read(wentOffline)).realtimeStatus, "UNKNOWN");
    } finally {
      await redis.del(...keys);
      for (const id of ids) { await redis.zrem("drivers:locations:last_seen", id); await redis.zrem("drivers:geo:BIKE", id); }
      redis.disconnect();
    }
  },
);
