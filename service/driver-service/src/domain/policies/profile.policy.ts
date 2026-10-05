import { Driver } from "../driver/driver";
export function profileEligible(driver: Driver): boolean {
  return !!driver.name.trim() && !!driver.licenseNumber.trim();
}
