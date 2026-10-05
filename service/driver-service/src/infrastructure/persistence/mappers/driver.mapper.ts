import { Driver as DriverEntity } from "../entities/driver.entity";
import { Driver } from "../../../domain/driver/driver";
import { desiredStatus } from "../../../domain/driver/status";
export function driverModel(row: DriverEntity | null): Driver | null {
  if (!row) return null;
  return {
    id: row.id,
    phone: row.phone,
    name: row.name,
    avatarUrl: row.avatarUrl,
    licenseNumber: row.licenseNumber,
    desiredStatus: desiredStatus(row.desiredStatus),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
