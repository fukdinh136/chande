import { Driver } from "../../domain/driver/driver";
export interface DriverRepository {
  driver(id: string, lock?: boolean): Promise<Driver | null>;
  driverByPhone(phone: string): Promise<Driver | null>;
  saveDriver(driver: Driver): Promise<Driver>;
}
