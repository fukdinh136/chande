import { DesiredStatus } from "../../domain/driver/status";
export interface State {
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
