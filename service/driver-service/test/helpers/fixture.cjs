require("reflect-metadata");
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { MockOtp } = require("../../src/infrastructure/otp/mock-otp");
const { RsaTokens } = require("../../src/infrastructure/auth/rsa-tokens");
const { runtime } = require("../../src/infrastructure/auth/runtime");
const {
  AuthUseCases,
} = require("../../src/application/use-cases/auth/auth.use-cases");
const { createTestUseCases } = require("./use-cases.cjs");
const { DriverError } = require("../../src/domain/value-objects/error");
const { validateVehicle } = require("../../src/domain/vehicle/vehicle.policy");
const { phoneNumber } = require("../../src/domain/value-objects/phone-number");
const { loadConfig } = require("../../src/bootstrap/config/configuration");
function fixture() {
  let at = Date.now();
  const clock = { ...runtime, now: () => new Date(at) };
  const driver = {
    id: randomUUID(),
    phone: "84912345678",
    name: "Driver",
    avatarUrl: null,
    licenseNumber: "LICENSE",
    desiredStatus: "OFFLINE",
    createdAt: new Date(at),
    updatedAt: new Date(at),
  };
  const vehicle = {
    id: randomUUID(),
    driverId: driver.id,
    vehicleType: "BIKE",
    vehiclePlate: "30A-12345",
    brandModel: "Honda Wave",
    color: "Blue",
    isActive: true,
    createdAt: new Date(at),
  };
  const refresh = new Map();
  let failInsert = false;
  const repo = {
    driver: async (id) => (id === driver.id ? driver : null),
    driverByPhone: async (phone) => (phone === driver.phone ? driver : null),
    saveDriver: async (value) => Object.assign(driver, value),
    vehicles: async () => [vehicle],
    vehicle: async (owner, id) =>
      owner === driver.id && id === vehicle.id ? vehicle : null,
    saveVehicle: async (value) => Object.assign(vehicle, value),
    refresh: async (hash) => refresh.get(hash) ?? null,
    saveRefresh: async (token) => {
      if (failInsert && !token.revokedAt)
        throw new DriverError("DEPENDENCY_UNAVAILABLE");
      refresh.set(token.tokenHash, token);
    },
  };
  let queue = Promise.resolve();
  const coordinates = new Map();
  const scope = new (require("node:async_hooks").AsyncLocalStorage)();
  const coordinate = (id, work) => {
    if (scope.getStore() === id) return work();
    const job = (coordinates.get(id) ?? Promise.resolve()).then(() =>
      scope.run(id, work),
    );
    coordinates.set(
      id,
      job.catch(() => {}),
    );
    return job;
  };
  const store = {
    coordinate,
    read: (fn) => fn(repo),
    transaction: (fn) => {
      const job = queue.then(async () => {
        const before = {
          driver: structuredClone(driver),
          vehicle: structuredClone(vehicle),
          refresh: structuredClone(refresh),
        };
        try {
          return await fn(repo);
        } catch (error) {
          Object.assign(driver, before.driver);
          Object.assign(vehicle, before.vehicle);
          refresh.clear();
          for (const [key, value] of before.refresh) refresh.set(key, value);
          throw error;
        }
      });
      queue = job.then(
        () => {},
        () => {},
      );
      return job;
    },
    ready: async () => true,
  };
  const cache = {
    projectedStatus: "OFFLINE",
    vehicleId: null,
    realtimeStatus: "UNKNOWN",
  };
  let unavailable = false;
  const state = {
    read: async () => {
      if (unavailable) throw new DriverError("DEPENDENCY_UNAVAILABLE");
      return { ...cache };
    },
    clearSelection: async (_, id) => {
      if (cache.vehicleId === id) cache.vehicleId = null;
    },
    select: async (_, id) => {
      cache.vehicleId = id;
    },
    setDesired: async (_, status) => {
      if (unavailable) throw new DriverError("DEPENDENCY_UNAVAILABLE");
      cache.projectedStatus = status;
    },
  };
  let active = null;
  let tripError = false;
  const trip = {
    active: async () => {
      if (tripError) throw new DriverError("DEPENDENCY_UNAVAILABLE");
      return active;
    },
  };
  const otp = new MockOtp(clock, "123456", 30, 5, 3);
  const tokens = new RsaTokens(
    "https://driver.local",
    ["driver-service", "trip-service", "realtime-service"],
    900,
  );
  return {
    driver,
    vehicle,
    cache,
    otp,
    tokens,
    store,
    state,
    trip,
    clock,
    repo,
    failInsert: () => {
      failInsert = true;
    },
    allowInsert: () => {
      failInsert = false;
    },
    redisRecover: () => {
      unavailable = false;
    },
    auth: new AuthUseCases(store, otp, tokens, clock, 900, 3600),
    app: createTestUseCases(store, state, trip, clock, ["BIKE"], 20),
    advance: (ms) => {
      at += ms;
    },
    active: (value) => {
      active = value;
    },
    tripError: () => {
      tripError = true;
    },
    redisError: () => {
      unavailable = true;
    },
  };
}
const rejectsCode = (promise, code) =>
  assert.rejects(promise, (error) => error.code === code);
module.exports = {
  fixture,
  rejectsCode,
  phoneNumber,
  validateVehicle,
  loadConfig,
};
