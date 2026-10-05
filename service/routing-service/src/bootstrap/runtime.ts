import type { BeforeApplicationShutdown } from '@nestjs/common';
import type { Config } from './config';
import { systemClock, type Clock, type MapProvider } from '../application/ports/clients';
import { MockMapProvider } from '../infrastructure/map/mock';
import { OsrmProvider } from '../infrastructure/map/osrm';
import { RateLimiter } from '../infrastructure/pipeline/limiter';
import { WorkerPool } from '../infrastructure/pipeline/pool';
import { CalculateRoute } from '../application/use-cases/route';
export class RoutingRuntime implements BeforeApplicationShutdown {
  readonly pool: WorkerPool; readonly route: CalculateRoute;
  constructor(readonly config: Config, readonly clock: Clock = systemClock, provider?: MapProvider) {
    const map = provider ?? (config.map.mode === 'mock' ? new MockMapProvider(clock) : new OsrmProvider(config, clock));
    this.pool = new WorkerPool(map, new RateLimiter(config.limits, clock), config.limits, clock);
    this.route = new CalculateRoute(this.pool, clock, config.vehicleTypes);
  }
  async beforeApplicationShutdown(): Promise<void> { await this.pool.close(); }
}
