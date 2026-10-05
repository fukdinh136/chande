const {
  EditPolicy,
} = require("../../src/application/use-cases/vehicle/edit.policy");
const {
  ProfileUseCases,
} = require("../../src/application/use-cases/profile/profile.use-cases");
const {
  VehicleUseCases,
} = require("../../src/application/use-cases/vehicle/vehicle.use-cases");
const {
  AvailabilityUseCases,
} = require("../../src/application/use-cases/availability/availability.use-cases");
const {
  EligibilityUseCase,
} = require("../../src/application/use-cases/eligibility/eligibility.use-case");
function createTestUseCases(store, state, trip, runtime, types, max) {
  const policy = new EditPolicy(store, trip),
    profile = new ProfileUseCases(store, runtime, policy),
    vehicle = new VehicleUseCases(store, runtime, types, max, policy, state),
    availability = new AvailabilityUseCases(store, state, policy, runtime),
    eligibility = new EligibilityUseCase(store, state, types);
  const groups = { profile, vehicle, availability, eligibility },
    app = { groups };
  for (const group of Object.values(groups))
    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(group)))
      if (key !== "constructor" && !["pending", "project"].includes(key))
        app[key] = group[key].bind(group);
  return app;
}
module.exports = { createTestUseCases };
