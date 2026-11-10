import type { Clock, Context, MapDispatcher } from '../ports/clients';
import { checkpoint } from '../context';
import { etaMatrixRequestSchema, request } from '../../domain/requests';
import { requireVehicle, measurement, type Cell } from '../../domain/models';
import { busy, invalidProvider } from '../../domain/errors';
// ETA from origins chosen by Matching to one destination (ADR-0001); Routing does not look up drivers.
// Batches run in sequence to keep provider load bounded; a failed batch fails the whole request.
export class CalculateEtaForOrigins {
  constructor(private readonly dispatcher: MapDispatcher, private readonly clock: Clock, private readonly vehicles: readonly string[], private readonly capacity: { matrixCandidates: number; matrixBatch: number; elementsPerMinute: number }) {}
  async execute(value: unknown, context: Context) {
    const input = request(etaMatrixRequestSchema, value); requireVehicle(input.vehicleType, this.vehicles); checkpoint(context, this.clock);
    if (input.origins.length > this.capacity.matrixCandidates) throw busy('matrix_too_large');
    const entries: ({ id: string } & Cell)[] = [];
    const size = Math.min(this.capacity.matrixBatch, this.capacity.elementsPerMinute);
    for (let index = 0; index < input.origins.length; index += size) {
      checkpoint(context, this.clock); const batch = input.origins.slice(index, index + size);
      const cells = await this.dispatcher.dispatch({ kind: 'matrix', input: { origins: batch.map(o => ({ lat: o.lat, lng: o.lng })), destination: input.destination, vehicleType: input.vehicleType } }, context);
      checkpoint(context, this.clock); if (cells.length !== batch.length) throw invalidProvider();
      for (const [i, cell] of cells.entries()) {
        const id = batch[i]!.id;
        if (cell.status === 'OK') entries.push({ id, status: 'OK', distanceMeters: measurement(cell.distanceMeters), durationSeconds: measurement(cell.durationSeconds) });
        else if (cell.status === 'NO_ROUTE' && cell.distanceMeters === null && cell.durationSeconds === null) entries.push({ id, ...cell });
        else throw invalidProvider();
      }
    }
    return { entries, calculatedAt: this.clock.iso() };
  }
}
