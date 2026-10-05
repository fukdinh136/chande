import { RealtimeError } from '../errors';
export const VEHICLE_TYPES = ['BIKE', 'CAR_4', 'CAR_7'] as const;
export type VehicleType = typeof VEHICLE_TYPES[number];
export interface NearbyQuery {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  vehicleType?: VehicleType;
}
export class NearbyPolicy {
  readonly maximumResults = 50;
  validate(query: NearbyQuery): Required<Pick<NearbyQuery, 'latitude' | 'longitude' | 'radiusMeters'>> & Pick<NearbyQuery, 'vehicleType'> {
    const radiusMeters = query.radiusMeters ?? 2000;
    if (!Number.isFinite(query.latitude) || Math.abs(query.latitude) > 85.05112878 ||
        !Number.isFinite(query.longitude) || Math.abs(query.longitude) > 180 ||
        !Number.isInteger(radiusMeters) || radiusMeters < 1 || radiusMeters > 2000 ||
        (query.vehicleType !== undefined && !VEHICLE_TYPES.includes(query.vehicleType)))
      throw new RealtimeError('INVALID_REQUEST');
    return { ...query, radiusMeters };
  }
}
