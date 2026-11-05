import { DesiredStatus } from "../../domain/driver/status";
export type Operational = 'AVAILABLE' | 'BUSY' | 'OFFLINE' | 'UNKNOWN';
export interface StateSnapshot { projectedStatus: DesiredStatus | null; vehicleId: string | null; realtimeStatus: string }
/** `vehicleId` set: write only while the driver is still ONLINE with that vehicle selected (`null` = none). Omitted: write always. */
export interface Projection { id: string; status: Operational; vehicleId?: string | null }
export interface State {
  /** One round trip for the whole batch, in the order of `ids`. */
  readMany(ids: readonly string[]): Promise<StateSnapshot[]>;
  /** One round trip; returns, per entry, whether the status was written. */
  projectMany?(entries: readonly Projection[]): Promise<boolean[]>;
  project?(id: string, status: 'AVAILABLE' | 'BUSY' | 'OFFLINE' | 'UNKNOWN'): Promise<void>;
  read(
    id: string,
  ): Promise<{
    projectedStatus: DesiredStatus | null;
    vehicleId: string | null;
    realtimeStatus: string;
  }>;
  select(id: string, vehicleId: string): Promise<void>;
  clearSelection(id: string, vehicleId: string): Promise<void>;
  setDesired(id: string, status: DesiredStatus): Promise<void>;
}
