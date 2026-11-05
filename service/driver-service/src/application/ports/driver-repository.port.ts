import { Driver } from "../../domain/driver/driver";
export interface DriverRepository {
  driver(id: string, lock?: boolean): Promise<Driver | null>;
  /** Reads a batch in one query. Rows whose status needs a data migration are reported apart. */
  drivers(ids: readonly string[]): Promise<{ found: Map<string, Driver>; migrationRequired: Set<string> }>;
  driverByPhone(phone: string): Promise<Driver | null>;
  saveDriver(driver: Driver): Promise<Driver>;
}
