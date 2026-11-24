import { LocationInput, LocationReceipt, NearbyLocation } from '../../domain/location/driver-location';
export const LOCATION_STORE = Symbol('LOCATION_STORE');
export interface LocationStore {
  update(driverId: string, location: LocationInput): Promise<LocationReceipt>;
  /**
   * Stored locations within the radius ranked `offset` to `offset + limit - 1` by distance, closest first.
   * `more` is true when the radius holds drivers beyond this page (ranking counts stale entries too, so a page
   * can return fewer than `limit` items and still have more).
   */
  nearest(query: { latitude: number; longitude: number; radiusMeters: number; limit: number; offset: number }): Promise<{ items: NearbyLocation[]; more: boolean }>;
  cleanup(): Promise<number>;
  ready(): Promise<boolean>;
}
