import { VehicleType } from '../../domain/policies/nearby.policy';
export const ELIGIBILITY_PROVIDER = Symbol('ELIGIBILITY_PROVIDER');
export interface Eligibility {
  driverId: string;
  eligible: boolean;
  availabilityKnown: boolean;
  vehicleType: VehicleType | null;
}
export interface EligibilityProvider {
  find(driverIds: readonly string[], vehicleType?: VehicleType): Promise<Eligibility[]>;
}
