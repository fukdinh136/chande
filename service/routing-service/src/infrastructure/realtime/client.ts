import type { Clock, Context, RealtimeLocationPort } from '../../application/ports/clients';
import type { Config } from '../../bootstrap/config';
import { driverSnapshot, type Location, type DriverLocation } from '../../domain/models';
import { RoutingError, deadline } from '../../domain/errors';
import { checkpoint } from '../../application/context';
/** Wire adapter can be injected once the Realtime API contract is supplied. No endpoint is invented here. */
export class RealtimeClient implements RealtimeLocationPort {
  constructor(private readonly source: RealtimeLocationPort, private readonly settings: Config['realtime'], private readonly clock: Clock) {}
  async findNearbyDriverLocations(center: Location, context: Context): Promise<DriverLocation[]> {
    checkpoint(context, this.clock);
    const controller = new AbortController(); const cancel = () => controller.abort(deadline());
    context.signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(this.clock.now() >= context.deadline ? deadline() : new RoutingError('REALTIME_DEADLINE_EXCEEDED', 504)), Math.max(1, Math.min(this.settings.timeout, context.deadline - this.clock.now())));
    try {
      const raw = await new Promise<DriverLocation[]>((resolve, reject) => {
        const abort = () => { cleanup(); reject(controller.signal.reason); };
        const cleanup = () => controller.signal.removeEventListener('abort', abort);
        controller.signal.addEventListener('abort', abort, { once: true });
        Promise.resolve().then(() => { checkpoint({ ...context, signal: controller.signal }, this.clock); return this.source.findNearbyDriverLocations(center, { ...context, signal: controller.signal }); }).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
      });
      checkpoint(context, this.clock);
      let size: number; try { size = Buffer.byteLength(JSON.stringify(raw)); } catch { throw new RoutingError('INVALID_REALTIME_RESPONSE', 503); }
      if (size > this.settings.maxResponse) throw new RoutingError('INVALID_REALTIME_RESPONSE', 503);
      return driverSnapshot(raw);
    } catch (error) {
      checkpoint(context, this.clock);
      if (error instanceof RoutingError) throw error;
      throw new RoutingError('REALTIME_UNAVAILABLE', 503);
    } finally { clearTimeout(timer); context.signal.removeEventListener('abort', cancel); }
  }
}
export class MockRealtimeLocations implements RealtimeLocationPort {
  readonly radiusMeters = 2000;
  constructor(private readonly clock: Clock) {}
  async findNearbyDriverLocations(center: Location, context: Context): Promise<DriverLocation[]> {
    checkpoint(context, this.clock); const observedAt = this.clock.iso();
    return ['mock-driver-a', 'mock-driver-b'].map((driverId, i) => ({ driverId, location: { lat: Math.max(-90, Math.min(90, center.lat + (i ? -0.001 : 0.001))), lng: center.lng }, observedAt }));
  }
}
