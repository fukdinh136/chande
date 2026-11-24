require("reflect-metadata");
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

// In-memory store and state that count round trips, so the test can prove the batch
// cost does not grow with the number of drivers.
function world(count) {
  const drivers = new Map(), vehicles = new Map(), states = new Map();
  const calls = { drivers: 0, vehicles: 0, readMany: 0, coordinate: 0 };
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
  const state = {
    readMany: async (ids) => { calls.readMany++; return ids.map(id => ({ ...(states.get(id) ?? { projectedStatus: null, vehicleId: null, realtimeStatus: "UNKNOWN" }) })); },
  };
  return { ids: [...drivers.keys()], drivers, vehicles, states, migration, calls, store, state };
}

const { CandidateEligibilityUseCase } = require("../../src/application/use-cases/eligibility/candidate-eligibility.use-case");
const { EligibilityUseCase } = require("../../src/application/use-cases/eligibility/eligibility.use-case");

test("candidates: 100 drivers in 2 SQL and 1 Redis read, with offer snapshots, no lock and no writes", async () => {
  const w = world(100);
  const { items } = await new CandidateEligibilityUseCase(w.store, w.state, ["BIKE"]).execute(w.ids, "BIKE");
  assert.deepEqual(w.calls, { drivers: 1, vehicles: 1, readMany: 1, coordinate: 0 });
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
