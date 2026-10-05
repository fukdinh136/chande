import type { Clock, Context, MapDispatcher, RealtimeLocationPort } from '../ports/clients';
import { checkpoint } from '../context';
import { matrixRequestSchema, request } from '../../domain/requests';
import { driverSnapshot, requireVehicle, measurement, type Cell, type DriverLocation } from '../../domain/models';
import { busy, invalidProvider } from '../../domain/errors';
export class CalculateEtaMatrix {
  constructor(private readonly realtime: RealtimeLocationPort, private readonly dispatcher: MapDispatcher, private readonly clock: Clock, private readonly vehicles: readonly string[], private readonly capacity: { matrixCandidates: number; matrixBatch: number; elementsPerMinute: number }) {}
  async execute(value: unknown, context: Context) {
    const input = request(matrixRequestSchema, value); requireVehicle(input.vehicleType, this.vehicles); checkpoint(context, this.clock);
    const drivers = driverSnapshot(await this.realtime.findNearbyDriverLocations(input.pickup, context, input.vehicleType)); checkpoint(context, this.clock);
    if (drivers.length > this.capacity.matrixCandidates) throw busy();
    const entries: (DriverLocation & Cell)[] = [];
    const size = Math.min(this.capacity.matrixBatch, this.capacity.elementsPerMinute);
    // Sequential batches keep provider load bounded; a failed batch fails the whole request.
    for (let index = 0; index < drivers.length; index += size) {
      checkpoint(context, this.clock); const batch = drivers.slice(index, index + size);
      const cells = await this.dispatcher.dispatch({ kind: 'matrix', input: { origins: batch.map(d => d.location), destination: input.pickup, vehicleType: input.vehicleType } }, context);
      checkpoint(context, this.clock); if (cells.length !== batch.length) throw invalidProvider();
      for (const [i, cell] of cells.entries()) {
        if (cell.status === 'OK') entries.push({ ...batch[i]!, status: 'OK', distanceMeters: measurement(cell.distanceMeters), durationSeconds: measurement(cell.durationSeconds) });
        else if (cell.status === 'NO_ROUTE' && cell.distanceMeters === null && cell.durationSeconds === null) entries.push({ ...batch[i]!, ...cell });
        else throw invalidProvider();
      }
    }
    return { entries, radiusMeters: 2000, hasReachableCandidate: entries.some(e => e.status === 'OK'), calculatedAt: this.clock.iso() };
  }
}
