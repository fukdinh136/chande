require("reflect-metadata");
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID, randomBytes } = require("node:crypto");
const { DataSource } = require("typeorm");
const {
  Driver,
} = require("../../src/infrastructure/persistence/entities/driver.entity");
const {
  Vehicle,
} = require("../../src/infrastructure/persistence/entities/vehicle.entity");
const {
  DriverRefreshToken,
} = require("../../src/infrastructure/persistence/entities/driver-refresh-token.entity");
const {
  PostgresStore,
} = require("../../src/infrastructure/persistence/unit-of-work/postgres.store");
const {
  AuthUseCases,
} = require("../../src/application/use-cases/auth/auth.use-cases");
const { MockOtp } = require("../../src/infrastructure/otp/mock-otp");
const { RsaTokens } = require("../../src/infrastructure/auth/rsa-tokens");
const { runtime } = require("../../src/infrastructure/auth/runtime");
const databaseUrl = process.env.DRIVER_TEST_DATABASE_URL;
const { storageTarget } = require("../helpers/storage-target.cjs");
test(
  "PostgreSQL rotation race, rollback and existing plate/license constraints (authoritative schema only)",
  { skip: !databaseUrl },
  async () => {
    storageTarget("postgres", databaseUrl);
    const source = new DataSource({
      type: "postgres",
      url: databaseUrl,
      entities: [Driver, Vehicle, DriverRefreshToken],
      installExtensions: false,
      synchronize: false,
      migrationsRun: false,
      logging: false,
      connectTimeoutMS: 5000,
      extra: { query_timeout: 5000 },
    });
    const id = randomUUID(),
      other = randomUUID(),
      license = "T" + id.replaceAll("-", "").slice(0, 18),
      plate = "T" + id.replaceAll("-", "").slice(0, 12);
    const phone =
      "84" +
      BigInt("0x" + randomBytes(5).toString("hex"))
        .toString()
        .padStart(12, "0");
    await source.initialize();
    try {
      const store = new PostgresStore(source);
      await store.assertSchema();
      // Independent coordinators use separate sessions, including after commit.
      const contender = new PostgresStore(source, 50);
      let entered, finish;
      const ready = new Promise((resolve) => {
        entered = resolve;
      });
      const held = new Promise((resolve) => {
        finish = resolve;
      });
      const first = store.coordinate(id, async () => {
        await store.transaction(async () => {});
        entered();
        await held; // The write transaction has ended; session lock remains.
      });
      try {
        await Promise.race([ready, first]);
        await assert.rejects(
          contender.coordinate(id, async () =>
            assert.fail("overtook projection"),
          ),
          (error) => error.code === "DEPENDENCY_UNAVAILABLE",
        );
      } finally {
        finish();
        await first;
      }
      await contender.coordinate(id, async () => {});
      const insert = (owner, number, lic) =>
        source.query(
          "INSERT INTO drivers(id,phone_number,password_hash,full_name,avatar_url,license_number,status,created_at,updated_at) VALUES($1,$2,$3,$4,NULL,$5,'OFFLINE',now(),now())",
          [owner, number, "isolated-test-hash", "Test Driver", lic],
        );
      await insert(id, phone, license);
      await assert.rejects(
        insert(
          other,
          phone.slice(0, -1) + (phone.endsWith("9") ? "0" : "9"),
          license,
        ),
        (error) => error.driverError?.code === "23505",
      );
      await store.transaction((repo) =>
        repo.saveVehicle({
          id: randomUUID(),
          driverId: id,
          vehicleType: "BIKE",
          vehiclePlate: plate,
          brandModel: "Test",
          color: "Blue",
          isActive: true,
          createdAt: new Date(),
        }),
      );
      await assert.rejects(
        store.transaction((repo) =>
          repo.saveVehicle({
            id: randomUUID(),
            driverId: id,
            vehicleType: "BIKE",
            vehiclePlate: plate,
            brandModel: "Duplicate",
            color: "Red",
            isActive: false,
            createdAt: new Date(),
          }),
        ),
        (error) => error.driverError?.code === "23505",
      );
      const otp = new MockOtp(runtime, "123456", 60, 1, 5),
        tokens = new RsaTokens(
          "https://isolated-driver.test",
          ["driver-service"],
          900,
        );
      const auth = new AuthUseCases(store, otp, tokens, runtime, 900, 3600),
        challenge = await auth.request(phone, "test");
      const session = await auth.verify(phone, challenge.challengeId, "123456");
      const results = await Promise.allSettled([
        auth.refresh(session.refreshToken),
        auth.refresh(session.refreshToken),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        results.find((r) => r.status === "rejected").reason.code,
        "INVALID_REFRESH_TOKEN",
      );
      const next = results.find((r) => r.status === "fulfilled").value;
      const failing = {
        read: (work) => store.read(work),
        transaction: (work) =>
          store.transaction((repo) =>
            work({
              ...repo,
              saveRefresh: async (record) => {
                if (!record.revokedAt)
                  throw new Error("injected insert failure");
                return repo.saveRefresh(record);
              },
            }),
          ),
      };
      const broken = new AuthUseCases(failing, otp, tokens, runtime, 900, 3600);
      await assert.rejects(
        broken.refresh(next.refreshToken),
        /injected insert failure/,
      );
      assert.ok((await auth.refresh(next.refreshToken)).refreshToken);
    } finally {
      try {
        // Both UUIDs were generated by this test; also clean an unexpected
        // successful duplicate insertion if a UNIQUE constraint is missing.
        await source.query(
          "DELETE FROM driver_refresh_tokens WHERE driver_id=ANY($1::uuid[])",
          [[id, other]],
        );
        await source.query(
          "DELETE FROM vehicles WHERE driver_id=ANY($1::uuid[])",
          [[id, other]],
        );
        await source.query("DELETE FROM drivers WHERE id=ANY($1::uuid[])", [
          [id, other],
        ]);
      } finally {
        await source.destroy();
      }
    }
  },
);
