import { Store } from '../../ports/unit-of-work.port';
import { State, StateSnapshot } from '../../ports/state.port';
import { DriverError } from '../../../domain/value-objects/error';
import { Driver } from '../../../domain/driver/driver';
import { Vehicle } from '../../../domain/vehicle/vehicle';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface BatchRead {
  found: Map<string, Driver>;
  migrationRequired: Set<string>;
  states: StateSnapshot[];
  /** The selected vehicle at index `i`, or null when none is selected or it belongs to another driver. */
  vehicle(id: string, i: number): Vehicle | null;
}
/** Validates a batch of 1..100 distinct driver ids and returns them lower-cased. */
export function batchIds(driverIds: readonly string[], types: readonly string[], type?: string) {
  const ids = driverIds.map(id => id.toLowerCase());
  if (!driverIds.length || driverIds.length > 100 || new Set(ids).size !== driverIds.length || driverIds.some(id => !UUID.test(id)) ||
      (type !== undefined && !types.includes(type))) throw new DriverError('INVALID_REQUEST');
  return ids;
}
// Drivers (1 SQL) and Redis state (1 script) in parallel, then selected vehicles (1 SQL).
export async function readBatch(store: Store, state: State, ids: readonly string[]): Promise<BatchRead> {
  const [{ found, migrationRequired }, states] = await Promise.all([
    store.read(repo => repo.drivers(ids)),
    state.readMany(ids),
  ]).catch(() => { throw new DriverError('DEPENDENCY_UNAVAILABLE'); });
  // Every selected vehicle, also for OFFLINE drivers, so the reasons match the single check. Still one query.
  const vehicleIds = ids.flatMap((id, i) => found.has(id) && states[i]!.vehicleId ? [states[i]!.vehicleId!] : []);
  const vehicles = new Map((await store.read(repo => repo.vehiclesById(vehicleIds)).catch(() => { throw new DriverError('DEPENDENCY_UNAVAILABLE'); })).map(v => [v.id, v]));
  return {
    found, migrationRequired, states,
    vehicle: (id, i) => { const selected = states[i]!.vehicleId ? vehicles.get(states[i]!.vehicleId!) : undefined; return selected && selected.driverId === id ? selected : null; },
  };
}
