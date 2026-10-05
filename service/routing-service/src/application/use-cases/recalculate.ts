import type { Context } from '../ports/clients';
import { recalculateSchema, request } from '../../domain/requests';
import type { CalculateRoute } from './route';
export class RecalculateRoute {
  constructor(private readonly route: CalculateRoute) {}
  execute(value: unknown, context: Context) {
    const input = request(recalculateSchema, value);
    return this.route.full({ origin: input.currentLocation, destination: input.destination, vehicleType: input.vehicleType, includeSteps: input.includeSteps }, context);
  }
}
