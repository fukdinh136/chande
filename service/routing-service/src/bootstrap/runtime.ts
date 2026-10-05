import type { BeforeApplicationShutdown } from '@nestjs/common';
import type { Config } from './config';
import { systemClock, type Clock, type MapProvider, type RealtimeLocationPort } from '../application/ports/clients';
import { MockMapProvider } from '../infrastructure/map/mock';
import { OsrmProvider } from '../infrastructure/map/osrm';
import { RateLimiter } from '../infrastructure/pipeline/limiter';
import { WorkerPool } from '../infrastructure/pipeline/pool';
import { CalculateRoute } from '../application/use-cases/route';
import { CalculateEtaMatrix } from '../application/use-cases/matrix';
import { MockRealtimeLocations, RealtimeClient } from '../infrastructure/realtime/client';
import { busy } from '../domain/errors';
export class RoutingRuntime implements BeforeApplicationShutdown {
  readonly pool: WorkerPool; readonly route: CalculateRoute; readonly matrix: CalculateEtaMatrix;
  private requests = new Set<AbortController>(); private requestDrained: (() => void)[] = [];
  constructor(readonly config: Config, readonly clock: Clock = systemClock, provider?: MapProvider, realtime?: RealtimeLocationPort) {
    if (config.realtime.mode === 'real' && !realtime) throw new Error('Realtime HTTP contract is not configured');
    const map = provider ?? (config.map.mode === 'mock' ? new MockMapProvider(clock) : new OsrmProvider(config, clock));
    this.pool = new WorkerPool(map, new RateLimiter(config.limits, clock), config.limits, clock);
    this.route = new CalculateRoute(this.pool, clock, config.vehicleTypes);
    this.matrix = new CalculateEtaMatrix(new RealtimeClient(realtime ?? new MockRealtimeLocations(clock), config.realtime, clock), this.pool, clock, config.vehicleTypes, config.limits);
  }
  track(controller: AbortController): () => void {
    if (!this.pool.stats.accepting || this.requests.size >= this.config.limits.queueSize + this.config.limits.workers) throw busy();
    this.requests.add(controller);
    return () => { this.requests.delete(controller); if (!this.requests.size) this.requestDrained.splice(0).forEach(resolve => resolve()); };
  }
  async beforeApplicationShutdown(): Promise<void> {
    const timer = setTimeout(() => { for (const request of this.requests) request.abort(busy()); }, this.config.limits.shutdownGrace);
    try {
      await this.pool.close();
      if (this.requests.size) await new Promise<void>(resolve => this.requestDrained.push(resolve));
    } finally { clearTimeout(timer); }
  }
}
