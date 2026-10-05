import { Driver } from '../driver/driver';
import { desiredStatus } from '../driver/status';
import { Vehicle } from '../vehicle/vehicle';
import { profileEligible } from './profile.policy';
export function eligibilityReasons(driver: Driver, vehicle: Vehicle | null, type?: string): string[] {
  const status = desiredStatus(driver.desiredStatus);
  const reasons: string[] = [];
  if (!profileEligible(driver)) reasons.push('PROFILE_INCOMPLETE');
  if (status !== 'ONLINE') reasons.push('DRIVER_OFFLINE');
  if (!vehicle) reasons.push('VEHICLE_REQUIRED');
  else {
    if (!vehicle.isActive) reasons.push('VEHICLE_INACTIVE');
    if (type !== undefined && vehicle.vehicleType !== type) reasons.push('VEHICLE_TYPE_MISMATCH');
  }
  return reasons;
}
