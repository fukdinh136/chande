const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const {
  fixture,
  rejectsCode,
  phoneNumber,
  validateVehicle,
  loadConfig,
} = require("../helpers/fixture.cjs");
test("canonical phone and column lengths reject invalid input without truncation", () => {
  assert.equal(phoneNumber("+84912345678"), "84912345678");
  assert.throws(() => phoneNumber("0912345678"));
  assert.throws(() =>
    validateVehicle(
      {
        vehicleType: "BIKE",
        licensePlate: "x".repeat(16),
        brandModel: "Wave",
        color: "Blue",
      },
      ["BIKE"],
    ),
  );
});
test("OTP wrong, expired, replay and maximum attempts are denied", async () => {
  const f = fixture();
  let challenge = await f.otp.request(f.driver.phone, "ip");
  await rejectsCode(
    f.otp.consume(f.driver.phone, challenge.challengeId, "000000"),
    "AUTHENTICATION_FAILED",
  );
  await f.otp.consume(f.driver.phone, challenge.challengeId, "123456");
  await rejectsCode(
    f.otp.consume(f.driver.phone, challenge.challengeId, "123456"),
    "AUTHENTICATION_FAILED",
  );
  f.advance(6000);
  challenge = await f.otp.request(f.driver.phone, "ip");
  f.advance(30000);
  await rejectsCode(
    f.otp.consume(f.driver.phone, challenge.challengeId, "123456"),
    "AUTHENTICATION_FAILED",
  );
  challenge = await f.otp.request(f.driver.phone, "ip");
  for (let n = 0; n < 3; n++)
    await rejectsCode(
      f.otp.consume(f.driver.phone, challenge.challengeId, "000000"),
      "AUTHENTICATION_FAILED",
    );
  await rejectsCode(
    f.otp.consume(f.driver.phone, challenge.challengeId, "123456"),
    "AUTHENTICATION_FAILED",
  );
});
test("OTP cooldown, IP rate limit, unknown account and no OTP in response", async () => {
  const f = fixture();
  const challenge = await f.auth.request("84912345679", "ip");
  assert.deepEqual(Object.keys(challenge).sort(), [
    "challengeId",
    "expiresIn",
    "retryAfterSeconds",
  ]);
  await rejectsCode(f.auth.request("84912345679", "ip"), "RATE_LIMITED");
  await rejectsCode(
    f.auth.verify("84912345679", challenge.challengeId, "123456"),
    "AUTHENTICATION_FAILED",
  );
  for (let n = 0; n < 9; n++) await f.auth.request(`849123457${10 + n}`, "ip");
  await rejectsCode(f.auth.request("84912345000", "ip"), "RATE_LIMITED");
});
test("session, concurrent refresh, reuse, logout and expiry with serialized store double", async () => {
  const f = fixture();
  const challenge = await f.auth.request(f.driver.phone, "ip");
  const session = await f.auth.verify(
    f.driver.phone,
    challenge.challengeId,
    "123456",
  );
  assert.equal(
    (await f.tokens.verify(`Bearer ${session.accessToken}`)).sub,
    f.driver.id,
  );
  const responses = await Promise.allSettled([
    f.auth.refresh(session.refreshToken),
    f.auth.refresh(session.refreshToken),
  ]);
  assert.equal(
    responses.filter((value) => value.status === "fulfilled").length,
    1,
  );
  assert.equal(
    responses.find((value) => value.status === "rejected").reason.code,
    "INVALID_REFRESH_TOKEN",
  );
  const next = responses.find((value) => value.status === "fulfilled").value;
  await f.auth.logout(next.refreshToken);
  await f.auth.logout(next.refreshToken);
  await rejectsCode(f.auth.refresh(next.refreshToken), "INVALID_REFRESH_TOKEN");
  f.advance(6000);
  const otherChallenge = await f.auth.request(f.driver.phone, "ip");
  const other = await f.auth.verify(
    f.driver.phone,
    otherChallenge.challengeId,
    "123456",
  );
  f.advance(3600001);
  await rejectsCode(
    f.auth.refresh(other.refreshToken),
    "INVALID_REFRESH_TOKEN",
  );
});
test("JWT rejects bad signature, issuer, audience, role, missing expiry", async () => {
  const f = fixture();
  const { JwtService } = require("@nestjs/jwt");
  await rejectsCode(
    f.tokens.verify(
      `Bearer ${new JwtService().sign({ sub: f.driver.id, role: "DRIVER" }, { secret: "untrusted" })}`,
    ),
    "UNAUTHENTICATED",
  );
  const jwt = new JwtService();
  for (const overrides of [
    { iss: "https://other.local" },
    { aud: "other-service" },
    { role: "RIDER" },
    { exp: Math.floor(Date.now() / 1000) - 1 },
    { exp: undefined },
  ]) {
    const payload = {
      sub: f.driver.id,
      role: "DRIVER",
      iss: "https://driver.local",
      aud: ["driver-service"],
      exp: Math.floor(Date.now() / 1000) + 100,
      iat: Math.floor(Date.now() / 1000),
      ...overrides,
    };
    if (payload.exp === undefined) delete payload.exp;
    const token = jwt.sign(payload, {
      privateKey: f.tokens.privateKey,
      algorithm: "RS256",
    });
    await rejectsCode(f.tokens.verify(`Bearer ${token}`), "UNAUTHENTICATED");
  }
  await rejectsCode(f.tokens.verify("Bearer malformed"), "UNAUTHENTICATED");
});
test("vehicle ownership, ONLINE requirements, snapshots, OFFLINE active trip and dependency errors", async () => {
  const f = fixture();
  await rejectsCode(
    f.app.vehicle(f.driver.id, randomUUID()),
    "RESOURCE_NOT_FOUND",
  );
  await rejectsCode(
    f.app.updateVehicle(
      f.driver.id,
      randomUUID(),
      { color: "Red" },
      "Bearer delegated",
    ),
    "RESOURCE_NOT_FOUND",
  );
  await rejectsCode(
    f.app.setAvailability(f.driver.id, "ONLINE"),
    "VEHICLE_REQUIRED",
  );
  await f.app.select(f.driver.id, f.vehicle.id, "Bearer delegated");
  f.vehicle.isActive = false;
  await rejectsCode(
    f.app.setAvailability(f.driver.id, "ONLINE"),
    "VEHICLE_INACTIVE",
  );
  f.vehicle.isActive = true;
  await f.app.setAvailability(f.driver.id, "ONLINE");
  assert.equal(
    (await f.app.eligibility(f.driver.id, "BIKE")).vehicleSnapshot.brand,
    f.vehicle.brandModel,
  );
  await rejectsCode(
    f.app.updateVehicle(
      f.driver.id,
      f.vehicle.id,
      { color: "Red" },
      "Bearer delegated",
    ),
    "DRIVER_MUST_BE_OFFLINE",
  );
  f.active({ tripId: randomUUID(), vehicleId: f.vehicle.id });
  await f.app.setAvailability(f.driver.id, "OFFLINE");
  await rejectsCode(
    f.app.select(f.driver.id, f.vehicle.id, "Bearer delegated"),
    "DRIVER_HAS_ACTIVE_TRIP",
  );
  f.active(null);
  f.tripError();
  await rejectsCode(
    f.app.updateVehicle(
      f.driver.id,
      f.vehicle.id,
      { color: "Red" },
      "Bearer delegated",
    ),
    "DEPENDENCY_UNAVAILABLE",
  );
  assert.equal(f.vehicle.color, "Blue");
  await f.app.setAvailability(f.driver.id, "OFFLINE");
  f.redisError();
  await rejectsCode(
    f.app.setAvailability(f.driver.id, "ONLINE"),
    "DEPENDENCY_UNAVAILABLE",
  );
});
test("production mock and semantic status changes fail closed", () => {
  assert.throws(
    () => loadConfig({ TRIP_MODE: "mock" }),
    /TRIP_MODE must be real/,
  );
  assert.throws(
    () => loadConfig({ NODE_ENV: "production", OTP_MODE: "mock" }),
    /Mock forbidden/,
  );
  assert.throws(
    () => loadConfig({ DRIVER_STATUS_MODE: "account" }),
    /requires ONLINE/,
  );
});

test("legacy statuses fail closed without converting blocked or active accounts", async () => {
  for (const status of ["ACTIVE", "PENDING", "BLOCKED"]) {
    const f = fixture();
    f.driver.desiredStatus = status;
    await rejectsCode(
      f.app.profile(f.driver.id),
      "DRIVER_STATUS_MIGRATION_REQUIRED",
    );
    await rejectsCode(
      f.app.setAvailability(f.driver.id, "ONLINE"),
      "DRIVER_STATUS_MIGRATION_REQUIRED",
    );
    const challenge = await f.auth.request(f.driver.phone, "ip");
    await rejectsCode(
      f.auth.verify(f.driver.phone, challenge.challengeId, "123456"),
      "DRIVER_STATUS_MIGRATION_REQUIRED",
    );
    assert.equal(f.driver.desiredStatus, status);
  }
});
test("OFFLINE commits even when Redis and Trip fail; recovery uses current PostgreSQL intent", async () => {
  const f = fixture();
  await f.app.select(f.driver.id, f.vehicle.id, "Bearer delegated");
  await f.app.setAvailability(f.driver.id, "ONLINE");
  f.cache.realtimeStatus = "BUSY";
  f.active({ tripId: randomUUID(), vehicleId: f.vehicle.id });
  f.redisError();
  f.tripError();
  const result = await f.app.setAvailability(f.driver.id, "OFFLINE");
  assert.equal(f.driver.desiredStatus, "OFFLINE");
  assert.equal(result.realtimeSync, "PENDING");
  assert.equal(
    (await f.app.availability(f.driver.id)).desiredStatus,
    "OFFLINE",
  );
  f.redisRecover();
  const recovered = await f.app.availability(f.driver.id);
  assert.equal(recovered.realtimeSync, "APPLIED");
  assert.equal(recovered.realtimeStatus, "BUSY");
  assert.equal(f.cache.projectedStatus, "OFFLINE");
});
test("failed PostgreSQL commit does not publish success or change Redis", async () => {
  const f = fixture();
  f.driver.desiredStatus = "ONLINE";
  f.cache.projectedStatus = "ONLINE";
  const before = f.cache.projectedStatus;
  f.repo.saveDriver = async () => {
    throw new Error("database failure");
  };
  await assert.rejects(f.app.setAvailability(f.driver.id, "OFFLINE"));
  assert.equal(f.cache.projectedStatus, before);
  assert.equal(f.driver.desiredStatus, "ONLINE");
});
test("inactive selected vehicle is cleared; stale selection never supplies eligibility snapshots", async () => {
  const f = fixture();
  await f.app.select(f.driver.id, f.vehicle.id, "Bearer delegated");
  await f.app.updateVehicle(
    f.driver.id,
    f.vehicle.id,
    { isActive: false },
    "Bearer delegated",
  );
  assert.equal(f.cache.vehicleId, null);
  f.cache.vehicleId = f.vehicle.id;
  f.driver.desiredStatus = "ONLINE";
  const result = await f.app.eligibility(f.driver.id, "BIKE");
  assert.equal(result.profileEligible, false);
  assert.ok(result.reasons.includes("VEHICLE_INACTIVE"));
  assert.equal(result.vehicleSnapshot, null);
  assert.equal((await f.app.availability(f.driver.id)).selectedVehicleId, null);
  assert.equal(f.cache.vehicleId, null);
});
test("cache loss preserves durable ONLINE intent but does not invent selection or AVAILABLE", async () => {
  const f = fixture();
  await f.app.select(f.driver.id, f.vehicle.id, "Bearer delegated");
  await f.app.setAvailability(f.driver.id, "ONLINE");
  f.cache.projectedStatus = null;
  f.cache.vehicleId = null;
  f.cache.realtimeStatus = "UNKNOWN";
  const result = await f.app.availability(f.driver.id);
  assert.equal(result.desiredStatus, "ONLINE");
  assert.equal(result.selectedVehicleId, null);
  assert.equal(result.realtimeStatus, "UNKNOWN");
  assert.equal(f.cache.projectedStatus, "ONLINE");
});
test("refresh insertion failure rolls back revocation so the old token can still rotate", async () => {
  const f = fixture(),
    challenge = await f.auth.request(f.driver.phone, "ip"),
    session = await f.auth.verify(
      f.driver.phone,
      challenge.challengeId,
      "123456",
    );
  f.failInsert();
  await rejectsCode(
    f.auth.refresh(session.refreshToken),
    "DEPENDENCY_UNAVAILABLE",
  );
  f.allowInsert();
  const next = await f.auth.refresh(session.refreshToken);
  assert.notEqual(next.refreshToken, session.refreshToken);
});
test("coordinated status commands project the final committed intent", async () => {
  const f = fixture();
  await f.app.select(f.driver.id, f.vehicle.id, "Bearer delegated");
  await Promise.all([
    f.app.setAvailability(f.driver.id, "ONLINE"),
    f.app.setAvailability(f.driver.id, "OFFLINE"),
  ]);
  assert.equal(f.driver.desiredStatus, "OFFLINE");
  assert.equal(f.cache.projectedStatus, "OFFLINE");
});

test("trusted proxy address requires its separate credential; spoofed headers use peer address", () => {
  const {
    clientAddress,
  } = require("../../src/presentation/http/guards/client-address");
  const req = {
    ip: "127.0.0.1",
    header: (name) =>
      ({
        "X-Driver-Proxy-Token": "proxy-test",
        "X-Driver-Client-IP": "192.0.2.1",
      })[name],
  };
  assert.equal(clientAddress(req, "proxy-test"), "192.0.2.1");
  assert.equal(clientAddress(req, "different"), "127.0.0.1");
  assert.equal(clientAddress(req, undefined), "127.0.0.1");
});

test("availability reads Redis before the write transaction and projects only after it commits", async () => {
  const f = fixture();
  await f.app.select(f.driver.id, f.vehicle.id, "Bearer delegated");
  let transactionOpen = false,
    committed = false;
  const transaction = f.store.transaction;
  f.store.transaction = (work) =>
    transaction(async (repo) => {
      transactionOpen = true;
      try {
        return await work(repo);
      } finally {
        transactionOpen = false;
        committed = true;
      }
    });
  const read = f.state.read,
    publish = f.state.setDesired;
  f.state.read = async (id) => {
    assert.equal(transactionOpen, false);
    return read(id);
  };
  f.state.setDesired = async (...args) => {
    assert.equal(transactionOpen, false);
    assert.equal(committed, true);
    return publish(...args);
  };
  assert.equal(
    (await f.app.setAvailability(f.driver.id, "ONLINE")).realtimeSync,
    "APPLIED",
  );
});
