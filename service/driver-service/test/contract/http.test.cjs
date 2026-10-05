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
test("Nest HTTP presentation runs from new backend path with isolated ports, DTO/envelope/role/ownership guards", async () => {
  const { Test } = require("@nestjs/testing");
  const { ValidationPipe } = require("@nestjs/common");
  const { randomUUID } = require("node:crypto");
  const {
    AuthController,
    ProfileController,
    VehicleController,
    AvailabilityController,
    InternalController,
    OperationsController,
  } = require("../../src/presentation/http/controllers");
  const {
    UserGuard,
    ServiceGuard,
    ErrorFilter,
  } = require("../../src/presentation/http");
  const { CONTEXT } = require("../../src/bootstrap/modules/driver-context");
  const f = fixture();
  const context = {
    auth: f.auth,
    ...f.app.groups,
    tokens: f.tokens,
    store: f.store,
    config: { matchingToken: "private-test-credential" },
    command: (_, work) => work(),
  };
  const module = await Test.createTestingModule({
    controllers: [
      AuthController,
      ProfileController,
      VehicleController,
      AvailabilityController,
      InternalController,
      OperationsController,
    ],
    providers: [
      { provide: CONTEXT, useValue: context },
      UserGuard,
      ServiceGuard,
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ErrorFilter());
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const call = async (path, method = "GET", body, token) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await call("/health/live")).body.status, "ok");
    assert.equal((await call("/drivers/me")).status, 401);
    assert.equal(
      (
        await call("/driver-auth/otp/request", "POST", {
          phoneNumber: f.driver.phone,
          driverId: f.driver.id,
        })
      ).status,
      400,
    );
    const challenge = (
      await call("/driver-auth/otp/request", "POST", {
        phoneNumber: f.driver.phone,
      })
    ).body.data;
    const session = (
      await call("/driver-auth/otp/verify", "POST", {
        phoneNumber: f.driver.phone,
        challengeId: challenge.challengeId,
        otp: "123456",
      })
    ).body.data;
    const profile = await call("/drivers/me", "GET", null, session.accessToken);
    assert.equal(profile.body.data.driverId, f.driver.id);
    assert.ok(profile.body.meta.requestId);
    assert.equal(
      (
        await call(
          "/drivers/me/vehicles/" + randomUUID(),
          "GET",
          null,
          session.accessToken,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await call(
          "/drivers/me/availability",
          "PUT",
          { desiredStatus: "ONLINE" },
          session.accessToken,
        )
      ).body.error.code,
      "VEHICLE_REQUIRED",
    );
    assert.equal(
      (
        await call(
          "/drivers/me/vehicles",
          "POST",
          {
            vehicleType: "BIKE",
            licensePlate: "A".repeat(16),
            brandModel: "Honda",
            color: "Blue",
          },
          session.accessToken,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await call(
          "/internal/drivers/" + f.driver.id + "/eligibility?vehicleType=BIKE",
          "GET",
          null,
          session.accessToken,
        )
      ).status,
      401,
    );
    assert.equal((await call("/auth/register", "POST", {})).status, 404);
    assert.equal(
      (await call("/.well-known/jwks.json")).body.keys[0].kty,
      "RSA",
    );
  } finally {
    await app.close();
  }
});
