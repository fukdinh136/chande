import { DriverError } from "../value-objects/error";
export type DesiredStatus = "ONLINE" | "OFFLINE";
export function desiredStatus(value: string): DesiredStatus {
  if (value !== "ONLINE" && value !== "OFFLINE")
    throw new DriverError("DRIVER_STATUS_MIGRATION_REQUIRED");
  return value;
}
