require("reflect-metadata");
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { BatchEligibilityUseCase } = require("../../src/application/use-cases/eligibility/batch-eligibility.use-case");
const { DriverError } = require("../../src/domain/value-objects/error");

// In-memory store and state that count round trips, so the test can prove the batch
// cost does not grow with the number of drivers.
function world(count) {
  const drivers = new Map(), vehicles = new Map(), states = new Map();
  const calls = { drivers: 0, vehicles: 0, readMany: 0, projectMany: 0, coordinate: 0 };
  for (let i = 0; i < count; i++) {
    const id = randomUUID(), vehicleId = randomUUID();
    drivers.set(id, { id, phone: "849" + String(i).padStart(8, "0"), name: "D" + i, avatarUrl: null, licenseNumber: "L" + i, desiredStatus: "ONLINE", createdAt: new Date(), updatedAt: new Date() });
    vehicles.set(vehicleId, { id: vehicleId, driverId: id, vehicleType: "BIKE", vehiclePlate: "30A-" + i, brandModel: null, color: null, isActive: true, createdAt: new Date() });
    states.set(id, { projectedStatus: "ONLINE", vehicleId, realtimeStatus: "AVAILABLE" });
  }
  const migration = new Set();
  const repo = {
    drivers: async (ids) => { calls.drivers++; return { found: new Map(ids.filter(id => drivers.has(id) && !migration.has(id)).map(id => [id, drivers.get(id)])), migrationRequired: new Set(ids.filter(id => migration.has(id))) }; },
    vehiclesById: async (ids) => { calls.vehicles++; return ids.filter(id => vehicles.has(id)).map(id => vehicles.get(id)); },
  };
  const store = { read: (fn) => fn(repo), coordinate: () => { calls.coordinate++; throw new Error("batch must not lock"); } };
  let skip = new Set(), projected = [];
  const state = {
    readMany: async (ids) => { calls.readMany++; return ids.map(id => ({ ...(states.get(id) ?? { projectedStatus: null, vehicleId: null, realtimeStatus: "UNKNOWN" }) })); },
    projectMany: async (entries) => { calls.projectMany++; projected.push(...entries); return entries.map(e => !skip.has(e.id)); },
  };
  return { ids: [...drivers.keys()], drivers, vehicles, states, migration, calls, store, state,
    skip: (id) => skip.add(id), projected: () => projected };
}
const free = (ids, busy = []) => ({ lookup: async () => new Map(ids.map(id => [id, busy.includes(id)])) });

test("batch eligibility: 100 drivers cost 2 SQL and 2 Redis round trips, no per-driver lock", async () => {
  const w = world(100);
  const { items } = await new BatchEligibilityUseCase(w.store, w.state, ["BIKE"], free(w.ids)).execute(w.ids, "BIKE");
  assert.equal(items.length, 100);
  assert.ok(items.every(item => item.eligible && item.operationalStatus === "AVAILABLE" && item.vehicleType === "BIKE"));
  assert.deepEqual(items.map(item => item.driverId), w.ids);
  assert.deepEqual(w.calls, { drivers: 1, vehicles: 1, readMany: 1, projectMany: 1, coordinate: 0 });
  // Conditional writes carry the vehicle read in the same batch.
  assert.ok(w.projected().every(p => p.status === "AVAILABLE" && p.vehicleId === w.states.get(p.id).vehicleId));
});

test("batch eligibility: keeps the per-driver rules", async () => {
  const w = world(6);
  const [offline, missingVehicle, foreignVehicle, busy, migrating, wrongType] = w.ids;
  w.drivers.get(offline).desiredStatus = "OFFLINE";
  w.states.get(missingVehicle).vehicleId = null;
  w.states.get(foreignVehicle).vehicleId = w.states.get(busy).vehicleId; // owned by another driver
  w.migration.add(migrating);
  w.vehicles.get(w.states.get(wrongType).vehicleId).vehicleType = "CAR_4";
  const unknown = randomUUID();
  const { items } = await new BatchEligibilityUseCase(w.store, w.state, ["BIKE", "CAR_4"], free([...w.ids, unknown], [busy])).execute([...w.ids, unknown], "BIKE");
  const by = Object.fromEntries(items.map(item => [item.driverId, item]));
  assert.deepEqual(by[offline].reasons, ["DRIVER_OFFLINE"]);
  assert.deepEqual(by[missingVehicle].reasons, ["VEHICLE_REQUIRED"]);
  assert.deepEqual(by[foreignVehicle].reasons, ["VEHICLE_REQUIRED"]);
  assert.equal(by[busy].eligible, false);
  assert.deepEqual(by[busy].reasons, ["DRIVER_BUSY"]);
  assert.deepEqual(by[migrating].reasons, ["DRIVER_STATUS_MIGRATION_REQUIRED"]);
  assert.deepEqual(by[wrongType].reasons, ["VEHICLE_TYPE_MISMATCH"]);
  assert.deepEqual(by[unknown].reasons, ["DRIVER_NOT_FOUND"]);
  assert.ok(items.every(item => !item.eligible));
  // Offline, unknown and migrating drivers are not projected, as before.
  assert.deepEqual(new Set(w.projected().map(p => p.id)), new Set([missingVehicle, foreignVehicle, busy, wrongType]));
});

test("batch eligibility: unknown projection after cache loss is not AVAILABLE", async () => {
  const w = world(1);
  w.states.get(w.ids[0]).projectedStatus = null;
  const { items } = await new BatchEligibilityUseCase(w.store, w.state, ["BIKE"]).execute(w.ids, "BIKE");
  assert.equal(items[0].eligible, false);
  assert.equal(items[0].availabilityKnown, false);
  assert.deepEqual(items[0].reasons, ["AVAILABILITY_UNDETERMINED"]);
  assert.equal(w.calls.projectMany, 0); // no occupancy, no projection
});

test("batch eligibility: a driver whose state changed during the check is not offered", async () => {
  const w = world(2);
  w.skip(w.ids[1]);
  const { items } = await new BatchEligibilityUseCase(w.store, w.state, ["BIKE"], free(w.ids)).execute(w.ids, "BIKE");
  assert.equal(items[0].eligible, true);
  assert.equal(items[1].eligible, false);
  assert.deepEqual(items[1].reasons, ["DRIVER_STATE_CHANGED"]);
});

test("batch eligibility: failed occupancy marks the batch UNKNOWN unconditionally", async () => {
  const w = world(3);
  const occupancy = { lookup: async () => { throw new Error("down"); } };
  await assert.rejects(new BatchEligibilityUseCase(w.store, w.state, ["BIKE"], occupancy).execute(w.ids, "BIKE"), (e) => e instanceof DriverError && e.code === "DEPENDENCY_UNAVAILABLE");
  assert.deepEqual(w.projected(), w.ids.map(id => ({ id, status: "UNKNOWN" })));
  assert.equal(w.calls.drivers, 0);
});

test("batch eligibility: a failed batch read is DEPENDENCY_UNAVAILABLE", async () => {
  const w = world(2);
  w.state.readMany = async () => { throw new Error("redis down"); };
  await assert.rejects(new BatchEligibilityUseCase(w.store, w.state, ["BIKE"]).execute(w.ids, "BIKE"), (e) => e.code === "DEPENDENCY_UNAVAILABLE");
});

test("batch eligibility: rejects invalid input before any read", async () => {
  const w = world(1);
  const use = new BatchEligibilityUseCase(w.store, w.state, ["BIKE"]);
  for (const input of [[], ["not-a-uuid"], [w.ids[0], w.ids[0].toUpperCase()], Array.from({ length: 101 }, () => randomUUID())])
    await assert.rejects(use.execute(input, "BIKE"), (e) => e.code === "INVALID_REQUEST");
  await assert.rejects(use.execute(w.ids, "BUS"), (e) => e.code === "INVALID_REQUEST");
  assert.equal(w.calls.drivers + w.calls.readMany, 0);
});

const { CandidateEligibilityUseCase } = require("../../src/application/use-cases/eligibility/candidate-eligibility.use-case");
const { EligibilityUseCase } = require("../../src/application/use-cases/eligibility/eligibility.use-case");

test("candidates: 100 drivers in 2 SQL and 1 Redis read, with offer snapshots and no writes", async () => {
  const w = world(100);
  const { items } = await new CandidateEligibilityUseCase(w.store, w.state, ["BIKE"]).execute(w.ids, "BIKE");
  assert.deepEqual(w.calls, { drivers: 1, vehicles: 1, readMany: 1, projectMany: 0, coordinate: 0 });
  assert.ok(items.every(item => item.eligible));
  const first = items[0], vehicle = w.vehicles.get(w.states.get(w.ids[0]).vehicleId);
  assert.deepEqual(first, { driverId: w.ids[0], eligible: true, reasons: [], vehicleId: vehicle.id,
    driverSnapshot: { fullName: "D0", avatarUrl: null }, vehicleSnapshot: { vehicleType: "BIKE", licensePlate: vehicle.vehiclePlate, brand: null, color: null } });
});

test("candidates: same answer as the single eligibility check, without asking who is busy", async () => {
  const w = world(5);
  const [offline, noVehicle, inactive, wrongType, busyInRedis] = w.ids;
  w.drivers.get(offline).desiredStatus = "OFFLINE";
  w.states.get(noVehicle).vehicleId = null;
  w.vehicles.get(w.states.get(inactive).vehicleId).isActive = false;
  w.vehicles.get(w.states.get(wrongType).vehicleId).vehicleType = "CAR_4";
  w.states.get(busyInRedis).realtimeStatus = "BUSY"; // Matching's reservations decide this now
  const { items } = await new CandidateEligibilityUseCase(w.store, w.state, ["BIKE", "CAR_4"]).execute(w.ids, "BIKE");
  const single = new EligibilityUseCase(
    { coordinate: (_, work) => work(), read: (fn) => fn({ driver: async (id) => w.drivers.get(id) ?? null, vehicle: async (owner, id) => { const v = w.vehicles.get(id); return v && v.driverId === owner ? v : null; } }) },
    { read: async (id) => ({ ...w.states.get(id) }) }, ["BIKE", "CAR_4"]);
  for (const item of items) {
    const one = await single.eligibility(item.driverId, "BIKE");
    assert.equal(item.eligible, one.profileEligible, item.driverId);
    assert.deepEqual(item.reasons, one.reasons);
    assert.deepEqual([item.driverSnapshot, item.vehicleSnapshot], [one.driverSnapshot, one.vehicleSnapshot]);
  }
  assert.equal(items[4].eligible, true);
  await assert.rejects(new CandidateEligibilityUseCase(w.store, w.state, ["BIKE"]).execute(w.ids, "BUS"), (e) => e.code === "INVALID_REQUEST");
});
