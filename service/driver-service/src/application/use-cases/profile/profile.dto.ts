import { Driver } from "../../../domain/driver/driver";
import { desiredStatus } from "../../../domain/driver/status";
export function profileDto(driver: Driver) {
  return {
    driverId: driver.id,
    phoneNumber: driver.phone.replace(/^\+/, ""),
    fullName: driver.name,
    avatarUrl: driver.avatarUrl,
    licenseNumber: driver.licenseNumber,
    desiredStatus: desiredStatus(driver.desiredStatus),
    createdAt: driver.createdAt.toISOString(),
    updatedAt: driver.updatedAt.toISOString(),
  };
}
