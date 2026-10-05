import { Driver as DriverEntity } from "../entities/driver.entity";
import { Driver } from "../../../domain/driver/driver";
import { DriverError } from "../../../domain/value-objects/error";
import { driverModel } from "../mappers/driver.mapper";
import { EntityManager } from "typeorm";
import { DriverRepository } from "../../../application/ports/driver-repository.port";
export class PostgresDriverRepository implements DriverRepository {
  constructor(private readonly manager: EntityManager) {}
  async driver(id: string, lock = false) {
    return driverModel(
      await this.manager.findOne(DriverEntity, {
        where: { id },
        ...(lock ? { lock: { mode: "pessimistic_write" as const } } : {}),
      }),
    );
  }
  async driverByPhone(phone: string) {
    // Support existing '+' storage without rewriting IDs or phone data.
    const rows = await this.manager.find(DriverEntity, {
      where: [{ phone }, { phone: `+${phone}` }],
      take: 2,
    });
    if (rows.length > 1) throw new DriverError("AUTHENTICATION_FAILED");
    return driverModel(rows[0] ?? null);
  }
  async saveDriver(driver: Driver) {
    await this.manager.update(DriverEntity, driver.id, {
      name: driver.name,
      avatarUrl: driver.avatarUrl,
      licenseNumber: driver.licenseNumber,
      updatedAt: driver.updatedAt,
      desiredStatus: driver.desiredStatus,
    });
    return driver;
  }
}
