const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  PostgresStore,
} = require("../../src/infrastructure/persistence/unit-of-work/postgres.store");
test("unit-of-work uses one pinned connection, rolls back failure and unlocks after projection error", async () => {
  const events = [],
    manager = {};
  let runners = 0;
  const runner = {
    manager,
    connect: async () => events.push("connect"),
    query: async (sql) => {
      const unlock = sql.includes("unlock");
      events.push(unlock ? "unlock" : "lock");
      return unlock ? [{ unlocked: true }] : [{ locked: true }];
    },
    startTransaction: async () => events.push("begin"),
    commitTransaction: async () => events.push("commit"),
    rollbackTransaction: async () => events.push("rollback"),
    release: async () => events.push("release"),
    releasePostgresConnection: async () => events.push("discard"),
  };
  const source = {
    manager: {},
    createQueryRunner: () => {
      runners++;
      return runner;
    },
  };
  const store = new PostgresStore(source);
  await assert.rejects(
    store.coordinate("driver", async () => {
      await store.coordinate("driver", async () => {
        await assert.rejects(
          store.transaction(async () => {
            throw new Error("rollback");
          }),
          /rollback/,
        );
      });
      await store.transaction(async () => {
        assert.equal(store.scope.getStore().runner.manager, manager);
      });
      throw new Error("projection failed");
    }),
    /projection failed/,
  );
  assert.equal(runners, 1);
  assert.deepEqual(events, [
    "connect",
    "lock",
    "begin",
    "rollback",
    "begin",
    "commit",
    "unlock",
    "release",
  ]);
});
test("a later command cannot overtake cache projection of an earlier committed command", async () => {
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const events = [];
  const runner = () => ({
    manager: {},
    connect: async () => {},
    query: async (sql) =>
      sql.includes("unlock") ? [{ unlocked: true }] : [{ locked: true }],
    release: async () => {},
    releasePostgresConnection: async () => {},
  });
  const store = new PostgresStore({ createQueryRunner: runner });
  const first = store.coordinate("driver", async () => {
    events.push("first commit");
    await wait;
    events.push("first projection");
  });
  await new Promise((resolve) => setImmediate(resolve));
  const second = store.coordinate("driver", async () =>
    events.push("second commit and projection"),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["first commit"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, [
    "first commit",
    "first projection",
    "second commit and projection",
  ]);
});

test("advisory lock contention times out without running a command or unlocking another owner", async () => {
  let called = false,
    released = false,
    unlocked = false;
  const runner = {
    connect: async () => {},
    query: async (sql) => {
      unlocked ||= sql.includes("unlock");
      return [{ locked: false }];
    },
    release: async () => {
      released = true;
    },
    releasePostgresConnection: async () =>
      assert.fail("healthy connection must be reusable"),
  };
  const store = new PostgresStore({ createQueryRunner: () => runner }, 10);
  await assert.rejects(
    store.coordinate("driver", async () => {
      called = true;
    }),
    (error) => error.code === "DEPENDENCY_UNAVAILABLE",
  );
  assert.equal(called, false);
  assert.equal(released, true);
  assert.equal(unlocked, false);
});

test("a lost acquisition reply discards the session because the lock may have been acquired", async () => {
  let discarded = false,
    called = false;
  const runner = {
    connect: async () => {},
    query: async () => {
      throw new Error("lost reply");
    },
    release: async () =>
      assert.fail("must not return uncertain session to pool"),
    releasePostgresConnection: async (error) => {
      assert.ok(error instanceof Error);
      discarded = true;
    },
  };
  await assert.rejects(
    new PostgresStore({ createQueryRunner: () => runner }).coordinate(
      "driver",
      async () => {
        called = true;
      },
    ),
    (error) => error.code === "DEPENDENCY_UNAVAILABLE",
  );
  assert.equal(discarded, true);
  assert.equal(called, false);
});

test("unlock failure discards the pinned connection and preserves the committed PENDING response", async () => {
  const {
    PostgresQueryRunner,
  } = require("typeorm/driver/postgres/PostgresQueryRunner");
  assert.equal(
    typeof PostgresQueryRunner.prototype.releasePostgresConnection,
    "function",
  );
  let discarded = false;
  const runner = {
    connect: async () => {},
    query: async (sql) => {
      if (sql.includes("unlock")) throw new Error("connection failed");
      return [{ locked: true }];
    },
    release: async () => assert.fail("must not return locked session to pool"),
    releasePostgresConnection: async () => {
      discarded = true;
    },
  };
  const result = await new PostgresStore({
    createQueryRunner: () => runner,
  }).coordinate("driver", async () => ({
    desiredStatus: "OFFLINE",
    realtimeSync: "PENDING",
  }));
  assert.equal(result.realtimeSync, "PENDING");
  assert.equal(discarded, true);
});
