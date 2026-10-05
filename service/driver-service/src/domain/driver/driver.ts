import { desiredStatus } from "./status";

import { DriverError } from "../value-objects/error";
export interface Driver {
  id: string;
  phone: string;
  name: string;
  avatarUrl: string | null;
  licenseNumber: string;
  desiredStatus: string;
  createdAt: Date;
  updatedAt: Date;
}
export function requireDriver(value: Driver | null): Driver {
  if (!value) throw new DriverError("RESOURCE_NOT_FOUND");
  desiredStatus(value.desiredStatus);
  return value;
}
