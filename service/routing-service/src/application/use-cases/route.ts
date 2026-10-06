import type { Clock, Context, MapDispatcher } from '../ports/clients';
import { checkpoint } from '../context';
import { estimateSchema, routeRequestSchema, request } from '../../domain/requests';
import { requireVehicle, measurement } from '../../domain/models';
import { invalidProvider } from '../../domain/errors';
export class CalculateRoute {
  constructor(private readonly dispatcher: MapDispatcher, private readonly clock: Clock, private readonly vehicles: readonly string[]) {}
  async estimate(value: unknown, context: Context) {
    const input = request(estimateSchema, value); requireVehicle(input.vehicleType, this.vehicles); checkpoint(context, this.clock);
    const result = await this.dispatcher.dispatch({ kind: 'route', input: { origin: input.pickup, destination: input.destination, vehicleType: input.vehicleType, full: false, includeSteps: false } }, context);
    checkpoint(context, this.clock);
    return { distanceMeters: measurement(result.distanceMeters), durationSeconds: measurement(result.durationSeconds) };
  }
  async full(value: unknown, context: Context) {
    const input = request(routeRequestSchema, value); requireVehicle(input.vehicleType, this.vehicles); checkpoint(context, this.clock);
    const result = await this.dispatcher.dispatch({ kind: 'route', input: { ...input, full: true } }, context);
    checkpoint(context, this.clock); if (!result.polyline) throw invalidProvider();
    return { distanceMeters: measurement(result.distanceMeters), durationSeconds: measurement(result.durationSeconds), vehicleType: input.vehicleType, polyline: result.polyline, steps: result.steps, calculatedAt: this.clock.iso() };
  }
  async navigation(value: unknown, context: Context) {
    const input = request(routeRequestSchema, value); requireVehicle(input.vehicleType, this.vehicles); checkpoint(context, this.clock);
    const result = await this.dispatcher.dispatch({ kind: 'route', input: { ...input, full: true, includeSteps: true, navigation: true } }, context);
    checkpoint(context, this.clock); if (!result.navigation) throw invalidProvider();
    return { schemaVersion: 1, provider: 'OSRM', geometryPrecision: 6, vehicleType: input.vehicleType, calculatedAt: this.clock.iso(), route: result.navigation };
  }
}
