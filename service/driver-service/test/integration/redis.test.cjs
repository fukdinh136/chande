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
