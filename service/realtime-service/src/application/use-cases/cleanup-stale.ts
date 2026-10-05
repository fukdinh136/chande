import { LocationStore } from '../ports/location-store.port';
export class CleanupStale {
  constructor(private readonly store: LocationStore) {}
  execute() { return this.store.cleanup(); }
}
