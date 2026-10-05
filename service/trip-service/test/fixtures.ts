import type { Assignment, Principal, Quote } from '../src/domain/models';
export const rider: Principal = { sub: '30000000-0000-4000-8000-000000000001', role: 'RIDER' };
export const driver: Principal = { sub: '40000000-0000-4000-8000-000000000001', role: 'DRIVER' };
export const now = new Date('2026-10-05T02:00:00Z');
export function quote(): Quote {
  return { quoteId: '10000000-0000-4000-8000-000000000001', riderId: rider.sub, pickup: { lat: 10.77, lng: 106.7 }, destination: { lat: 10.78, lng: 106.69 }, vehicleType: 'MOCK_BIKE', route: { distanceMeters: 4000, durationSeconds: 600 }, fare: { currency: 'VND', amount: '45000', breakdown: [{ code: 'BASE', amount: '45000' }] }, createdAt: now.toISOString(), expiresAt: new Date(+now + 300000).toISOString(), consumedTripId: null };
}
export function assignment(): Assignment { return { eventId: '60000000-0000-4000-8000-000000000001', driverId: driver.sub, vehicleId: '50000000-0000-4000-8000-000000000001', driverSnapshot: { fullName: 'Test Driver', avatarUrl: null }, vehicleSnapshot: { vehicleType: 'MOCK_BIKE', licensePlate: 'TEST', brand: null, color: null } }; }
