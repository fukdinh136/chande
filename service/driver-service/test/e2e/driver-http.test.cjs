require("reflect-metadata");
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Test } = require("@nestjs/testing");
const { ValidationPipe } = require("@nestjs/common");
const controllers = require("../../src/presentation/http/controllers");
const { RealtimeInternalController } = require("../../src/presentation/http/controllers/realtime-internal.controller");
const { RealtimeServiceGuard } = require("../../src/presentation/http/guards/realtime-service.guard");
const { UserGuard, ServiceGuard, ErrorFilter } = require("../../src/presentation/http");
const { CONTEXT } = require("../../src/bootstrap/modules/driver-context");
const { BatchEligibilityUseCase } = require("../../src/application/use-cases/eligibility/batch-eligibility.use-case");
const { fixture } = require("../helpers/fixture.cjs");

// HTTP presentation + real Driver use cases; storage/Trip ports are in memory.
// This does not verify PostgreSQL, Redis, Socket.IO, Matching or Trip runtime.
test("direct Driver HTTP: session, owned vehicle, intent, active Trip and pending projection", async () => {
  const f = fixture();
  const realtimeToken = "isolated-realtime-credential-for-test-only";
  const context = {
    auth: f.auth,
    ...f.app.groups,
    batchEligibility: new BatchEligibilityUseCase(f.store, f.state, ["BIKE"]),
    tokens: f.tokens,
    store: f.store,
    config: { matchingToken: "test-service", realtimeToken, gatewayProxyToken: "" },
  };
  const module = await Test.createTestingModule({
    controllers: [...Object.values(controllers), RealtimeInternalController],
    providers: [
      { provide: CONTEXT, useValue: context },
      UserGuard,
      ServiceGuard,
      RealtimeServiceGuard,
    ],
  }).compile();
  const backend = module.createNestApplication({ logger: false });
  backend.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    next();
  });
  backend.useGlobalPipes(new ValidationPipe({
    whitelist: true, forbidNonWhitelisted: true, transform: true,
    transformOptions: { enableImplicitConversion: false },
  }));
  backend.useGlobalFilters(new ErrorFilter());
  try {
    await backend.listen(0, "127.0.0.1");
    const base = await backend.getUrl();
    let accessToken;
    const call = async (method, route, body, headers = {}) => {
      const response = await fetch(base + route, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: "Bearer " + accessToken } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    };
    const expectError = (result, status, code) => {
      assert.equal(result.status, status);
      assert.equal(result.body.error.code, code);
      assert.ok(result.body.meta.requestId);
    };
    expectError(await call("GET", "/drivers/me"), 401, "UNAUTHENTICATED");
    const challenge = await call("POST", "/driver-auth/otp/request", { phoneNumber: f.driver.phone });
    assert.equal(challenge.status, 200);
    const session = await call("POST", "/driver-auth/otp/verify", {
      phoneNumber: f.driver.phone, challengeId: challenge.body.data.challengeId, otp: "123456",
    });
    assert.equal(session.status, 200);
    accessToken = session.body.data.accessToken;
    assert.equal((await call("GET", "/drivers/me")).body.data.driverId, f.driver.id);
    assert.equal((await call("PATCH", "/drivers/me", { fullName: "Driver HTTP" })).body.data.fullName, "Driver HTTP");
    expectError(await call("PUT", "/drivers/me/availability", { desiredStatus: "ONLINE" }), 409, "VEHICLE_REQUIRED");
    expectError(await call("POST", "/drivers/me/vehicles", {
      driverId: randomUUID(), vehicleType: "BIKE", licensePlate: "HTTP-001", brandModel: "Honda", color: "Blue",
    }), 400, "INVALID_REQUEST");
    const created = await call("POST", "/drivers/me/vehicles", {
      vehicleType: "BIKE", licensePlate: "HTTP-001", brandModel: "Honda", color: "Blue",
    });
    assert.equal(created.status, 201);
    const vehicleId = created.body.data.vehicleId;
    assert.equal((await call("GET", "/drivers/me/vehicles/" + vehicleId)).body.data.vehicleId, vehicleId);
    expectError(await call("GET", "/drivers/me/vehicles/" + randomUUID()), 404, "RESOURCE_NOT_FOUND");
    assert.equal((await call("PUT", "/drivers/me/selected-vehicle", { vehicleId })).status, 200);
    const online = await call("PUT", "/drivers/me/availability", { desiredStatus: "ONLINE" });
    assert.equal(online.body.data.desiredStatus, "ONLINE");
    assert.equal(online.body.data.realtimeSync, "APPLIED");
    assert.equal(online.body.data.realtimeStatus, "UNKNOWN");
    expectError(await call("POST", "/internal/drivers/eligibility/batch", { driverIds: [f.driver.id] }), 401, "INVALID_SERVICE_CREDENTIAL");
    const batch = await call("POST", "/internal/drivers/eligibility/batch", { driverIds: [f.driver.id], vehicleType: "BIKE" }, { "X-Service-Token": realtimeToken });
    assert.equal(batch.status, 200);
    assert.equal(batch.body.data.items[0].eligible, false);
    assert.equal(batch.body.data.items[0].availabilityKnown, false);
    const active = { tripId: randomUUID(), vehicleId };
    f.active(active);
    f.cache.realtimeStatus = "BUSY";
    const offline = await call("PUT", "/drivers/me/availability", { desiredStatus: "OFFLINE" });
    assert.equal(offline.body.data.desiredStatus, "OFFLINE");
    assert.equal(offline.body.data.realtimeStatus, "BUSY");
    assert.deepEqual(await f.trip.active(), active);
    expectError(await call("PUT", "/drivers/me/selected-vehicle", { vehicleId }), 409, "DRIVER_HAS_ACTIVE_TRIP");
    f.active(null);
    assert.equal((await call("PATCH", "/drivers/me/vehicles/" + vehicleId, { isActive: false })).body.data.isActive, false);
    assert.equal((await call("GET", "/drivers/me/availability")).body.data.selectedVehicleId, null);
    expectError(await call("PUT", "/drivers/me/selected-vehicle", { vehicleId }), 409, "VEHICLE_INACTIVE");
    f.redisError();
    const pending = await call("PUT", "/drivers/me/availability", { desiredStatus: "OFFLINE" });
    assert.equal(pending.status, 200);
    assert.equal(pending.body.data.realtimeSync, "PENDING");
    assert.equal(f.driver.desiredStatus, "OFFLINE");
    f.redisRecover();
    assert.equal((await call("GET", "/drivers/me/availability")).body.data.realtimeSync, "APPLIED");
    const rotations = await Promise.all([
      call("POST", "/driver-auth/refresh", { refreshToken: session.body.data.refreshToken }),
      call("POST", "/driver-auth/refresh", { refreshToken: session.body.data.refreshToken }),
    ]);
    assert.deepEqual(rotations.map(value => value.status).sort(), [200, 401]);
    const rotated = rotations.find(value => value.status === 200).body.data;
    assert.equal((await call("POST", "/driver-auth/logout", { refreshToken: rotated.refreshToken })).body.data.loggedOut, true);
    expectError(await call("POST", "/driver-auth/refresh", { refreshToken: rotated.refreshToken }), 401, "INVALID_REFRESH_TOKEN");
  } finally {
    await backend.close();
  }
});
