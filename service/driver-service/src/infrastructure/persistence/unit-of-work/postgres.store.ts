import { AsyncLocalStorage } from "node:async_hooks";
import { DataSource, QueryRunner, EntityManager } from "typeorm";
import {
  Store,
  Repositories,
} from "../../../application/ports/unit-of-work.port";
import { PostgresDriverRepository } from "../repositories/driver.repository";
import { PostgresVehicleRepository } from "../repositories/vehicle.repository";
import { PostgresRefreshTokenRepository } from "../repositories/refresh-token.repository";
import { DriverSchemaInspector } from "../repositories/schema.inspector";
import { DriverError } from "../../../domain/value-objects/error";
// TypeORM's PostgreSQL runner passes this error to pg-pool, which destroys
// the connection instead of putting a possibly locked session back in the pool.
interface DiscardableRunner extends QueryRunner {
  releasePostgresConnection(error: Error): Promise<void>;
}
function repositories(manager: EntityManager): Repositories {
  const driver = new PostgresDriverRepository(manager),
    vehicle = new PostgresVehicleRepository(manager),
    token = new PostgresRefreshTokenRepository(manager);
  return {
    driver: (...args) => driver.driver(...args),
    driverByPhone: (...args) => driver.driverByPhone(...args),
    saveDriver: (...args) => driver.saveDriver(...args),
    vehicles: (...args) => vehicle.vehicles(...args),
    vehicle: (...args) => vehicle.vehicle(...args),
    saveVehicle: (...args) => vehicle.saveVehicle(...args),
    refresh: (...args) => token.refresh(...args),
    saveRefresh: (...args) => token.saveRefresh(...args),
  };
}
export class PostgresStore implements Store {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly scope = new AsyncLocalStorage<{
    id: string;
    runner: QueryRunner;
  }>();
  private readonly inspector: DriverSchemaInspector;
  constructor(
    private readonly source: DataSource,
    private readonly lockWaitMs = 10000,
  ) {
    this.inspector = new DriverSchemaInspector(source);
  }
  read<T>(work: (repo: Repositories) => Promise<T>) {
    return work(
      repositories(
        this.scope.getStore()?.runner.manager ?? this.source.manager,
      ),
    );
  }
  async transaction<T>(work: (repo: Repositories) => Promise<T>) {
    const runner = this.scope.getStore()?.runner;
    if (!runner)
      return this.source.transaction((manager) => work(repositories(manager)));
    await runner.startTransaction();
    try {
      const value = await work(repositories(runner.manager));
      await runner.commitTransaction();
      return value;
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    }
  }
  async coordinate<T>(id: string, work: () => Promise<T>): Promise<T> {
    const current = this.scope.getStore();
    if (current) {
      if (current.id !== id) throw new Error("Nested driver lock mismatch");
      return work();
    }
    const previous = this.queues.get(id) ?? Promise.resolve();
    const job = previous.then(() => this.locked(id, work));
    const tail = job.then(
      () => {},
      () => {},
    );
    this.queues.set(id, tail);
    try {
      return await job;
    } finally {
      if (this.queues.get(id) === tail) this.queues.delete(id);
    }
  }
  private async locked<T>(id: string, work: () => Promise<T>): Promise<T> {
    const runner = this.source.createQueryRunner() as DiscardableRunner;
    if (typeof runner.releasePostgresConnection !== "function")
      throw new Error("PostgreSQL runner must support discarding connections");
    let locked = false;
    let unsafe = false;
    try {
      await runner.connect();
      const deadline = Date.now() + this.lockWaitMs;
      while (!locked) {
        try {
          const rows: { locked: boolean }[] = await runner.query(
            "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
            [id],
          );
          locked = rows[0]?.locked === true;
        } catch {
          // A lost reply does not prove that PostgreSQL failed to acquire it.
          unsafe = true;
          throw new DriverError("DEPENDENCY_UNAVAILABLE");
        }
        if (!locked) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new DriverError("DEPENDENCY_UNAVAILABLE");
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(25, remaining)),
          );
        }
      }
      return await this.scope.run({ id, runner }, work);
    } finally {
      try {
        if (runner.isTransactionActive) unsafe = true;
        if (locked && !unsafe) {
          const rows: { unlocked: boolean }[] = await runner.query(
            "SELECT pg_advisory_unlock(hashtextextended($1,0)) AS unlocked",
            [id],
          );
          if (rows[0]?.unlocked !== true) unsafe = true;
        }
      } catch {
        unsafe = true;
      } finally {
        if (unsafe)
          await runner.releasePostgresConnection(
            new Error("Driver coordinator session could not be safely reused"),
          );
        else await runner.release();
      }
    }
  }
  ready() {
    return this.inspector.ready();
  }
  assertSchema() {
    return this.inspector.assertSchema();
  }
}
