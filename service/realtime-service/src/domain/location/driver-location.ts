export interface LocationInput {
  latitude: number;
  longitude: number;
  accuracy: number;
  recordedAt: string;
}
export interface DriverLocation extends LocationInput {
  driverId: string;
  receivedAt: string;
}
export interface NearbyLocation extends DriverLocation { distanceMeters: number }
export interface LocationReceipt {
  accepted: true;
  disposition: 'STORED' | 'DUPLICATE';
  recordedAt: string;
  receivedAt: string;
}
