import { LocationStore } from '../ports/location-store.port';
import { LocationPolicy } from '../../domain/policies/location.policy';
import { LocationInput } from '../../domain/location/driver-location';
export class UpdateLocation {
  constructor(private readonly store: LocationStore, private readonly policy: LocationPolicy) {}
  execute(driverId: string, location: LocationInput) {
    this.policy.validate(location, Date.now());
    return this.store.update(driverId, location);
  }
}
