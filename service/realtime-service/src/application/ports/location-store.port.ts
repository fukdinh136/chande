import { LocationInput, LocationReceipt, NearbyLocation } from '../../domain/location/driver-location';
export const LOCATION_STORE = Symbol('LOCATION_STORE');
export interface LocationStore {
  update(driverId: string, location: LocationInput): Promise<LocationReceipt>;
  /** At most `limit` stored locations within the radius, closest first. */
  nearest(query: { latitude: number; longitude: number; radiusMeters: number; limit: number }): Promise<NearbyLocation[]>;
  cleanup(): Promise<number>;
  ready(): Promise<boolean>;
}
