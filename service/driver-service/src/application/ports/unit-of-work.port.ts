import { DriverRepository } from "./driver-repository.port";
import { VehicleRepository } from "./vehicle-repository.port";
import { RefreshTokenRepository } from "./refresh-token-repository.port";

export type Repositories = DriverRepository &
  VehicleRepository &
  RefreshTokenRepository;

export interface Store {
  coordinate<T>(id: string, work: () => Promise<T>): Promise<T>;
  read<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
  transaction<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
  ready(): Promise<boolean>;
}
