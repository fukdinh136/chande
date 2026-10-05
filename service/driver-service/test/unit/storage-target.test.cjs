const test = require("node:test"),
  assert = require("node:assert/strict");
const { storageTarget } = require("../helpers/storage-target.cjs");
test("integration target guards reject shared/remote targets and overrides before any connection", () => {
  const approved = { DRIVER_TEST_STORAGE_ACK: "ISOLATED_DRIVER_TEST_ONLY" };
  assert.throws(() =>
    storageTarget("postgres", "postgresql://localhost/team_driver_test", {}),
  );
  for (const raw of [
    "postgresql://localhost/driver_db",
    "postgresql://remote/team_driver_test",
    "postgresql://localhost/team_driver_test?options=override",
    "http://localhost/team_driver_test",
  ])
    assert.throws(() => storageTarget("postgres", raw, approved));
  for (const raw of [
    "redis://localhost:6379/15",
    "redis://localhost:16379/0",
    "redis://remote:16379/15",
    "redis://localhost:16379/15?db=0",
    "http://localhost:16379/15",
  ])
    assert.throws(() => storageTarget("redis", raw, approved));
  assert.equal(
    storageTarget(
      "postgres",
      "postgresql://localhost/team_driver_test",
      approved,
    ).pathname,
    "/team_driver_test",
  );
  assert.equal(
    storageTarget("redis", "redis://localhost:16379/15", approved).port,
    "16379",
  );
});
