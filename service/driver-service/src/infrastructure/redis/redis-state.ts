import Redis from "ioredis";
import { State } from "../../application/ports/state.port";
import { DesiredStatus } from "../../domain/driver/status";
import { DriverError } from "../../domain/value-objects/error";
export class RedisState implements State {
  project(id: string, status: 'AVAILABLE' | 'BUSY' | 'OFFLINE' | 'UNKNOWN') { return this.command(async () => { await this.redis.hset(`driver:${id}:state`, 'status', status); }); }
  constructor(
    private readonly redis: Redis,
    private readonly types: readonly string[],
  ) {}
  private async command<T>(work: () => Promise<T>) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof DriverError) throw error;
      throw new DriverError("DEPENDENCY_UNAVAILABLE");
    }
  }
  read(id: string) {
    return this.command(async () => {
      const values = (await this.redis.eval(
        "return {redis.call('GET',KEYS[1]) or '',redis.call('HGET',KEYS[2],'vehicle_id') or '',redis.call('HGET',KEYS[2],'status') or 'UNKNOWN'}",
        2,
        `driver:${id}:availability`,
        `driver:${id}:state`,
      )) as string[];
      const projectedStatus: DesiredStatus | null =
        values[0] === "ONLINE"
          ? "ONLINE"
          : values[0] === "OFFLINE"
            ? "OFFLINE"
            : null;
      return {
        projectedStatus,
        vehicleId: values[1] || null,
        realtimeStatus: ["AVAILABLE", "BUSY", "OFFLINE"].includes(values[2])
          ? values[2]
          : "UNKNOWN",
      };
    });
  }
  select(id: string, vehicleId: string) {
    return this.command(async () => {
      await this.redis.eval(
        "redis.call('HSET',KEYS[1],'vehicle_id',ARGV[1]);redis.call('PERSIST',KEYS[1]);return 1",
        1,
        `driver:${id}:state`,
        vehicleId,
      );
    });
  }
  clearSelection(id: string, vehicleId: string) {
    return this.command(async () => {
      await this.redis.eval(
        "if redis.call('HGET',KEYS[1],'vehicle_id')~=ARGV[2] then return 0 end;redis.call('HDEL',KEYS[1],'vehicle_id');for i=2,#KEYS do redis.call('ZREM',KEYS[i],ARGV[1]) end;if redis.call('HGET',KEYS[1],'status')~='BUSY' then redis.call('HSET',KEYS[1],'status','OFFLINE') end;return 1",
        2 + this.types.length,
        `driver:${id}:state`,
        "drivers:locations:last_seen",
        ...this.types.map((type) => `drivers:geo:${type}`),
        id,
        vehicleId,
      );
    });
  }
  setDesired(id: string, status: DesiredStatus) {
    return this.command(async () => {
      await this.redis.eval(
        "redis.call('SET',KEYS[1],ARGV[2]);redis.call('PERSIST',KEYS[2]);if redis.call('HGET',KEYS[2],'status')~='BUSY' then if ARGV[2]=='OFFLINE' then redis.call('HSET',KEYS[2],'status','OFFLINE') else redis.call('HDEL',KEYS[2],'status') end end;if ARGV[2]=='OFFLINE' then for i=3,#KEYS do redis.call('ZREM',KEYS[i],ARGV[1]) end;redis.call('HDEL',KEYS[2],'last_seen','vehicle_type') end;return 1",
        3 + this.types.length,
        `driver:${id}:availability`,
        `driver:${id}:state`,
        "drivers:locations:last_seen",
        ...this.types.map((type) => `drivers:geo:${type}`),
        id,
        status,
      );
    });
  }
}
