import { z } from 'zod';
export const uuid = z.uuid().transform(v => v.toLowerCase());
export const vehicle = z.enum(['BIKE', 'CAR_4', 'CAR_7']);
export const location = z.object({ lat: z.number().min(-85.0511).max(85.0511), lng: z.number().min(-180).max(180), address: z.string().max(500).optional() }).strict();
export const searchCommand = z.object({ commandId: uuid, type: z.literal('matching.search.requested'), tripId: uuid, tripVersion: z.number().int().positive(), occurredAt: z.iso.datetime(), riderId: uuid, pickup: location, destination: location, vehicleType: vehicle, route: z.object({ distanceMeters: z.number().int().nonnegative(), durationSeconds: z.number().int().nonnegative() }).strict(), fare: z.object({ currency: z.literal('VND'), amount: z.string().regex(/^\d+$/) }).strict() }).strict();
export const cancelCommand = z.object({ commandId: uuid, type: z.literal('matching.search.cancelled'), tripId: uuid, tripVersion: z.number().int().positive(), occurredAt: z.iso.datetime(), reason: z.string().max(2000) }).strict();
export const completedEvent = z.object({ schemaVersion: z.literal(1), eventId: uuid, type: z.literal('trip.completed'), tripId: uuid, tripVersion: z.number().int().positive(), occurredAt: z.iso.datetime(), data: z.object({ riderId: uuid, driverId: uuid.nullable(), status: z.literal('COMPLETED') }).strict() }).strict();
export type Command = z.infer<typeof searchCommand>;
export type SearchStatus = 'SEARCHING' | 'ASSIGNMENT_PENDING' | 'ASSIGNED' | 'CANCELLED' | 'COMPLETED';
export type OfferStatus = 'PENDING' | 'ASSIGNMENT_PENDING' | 'ASSIGNED' | 'DECLINED' | 'EXPIRED' | 'REJECTED' | 'REVOKED';
export interface Search { tripId: string; status: SearchStatus; command: Command | null; offerId: string | null; attempts: number }
export interface Assignment { eventId: string; driverId: string; vehicleId: string; driverSnapshot: { fullName: string; avatarUrl: string | null }; vehicleSnapshot: { vehicleType: string; licensePlate: string; brand: string | null; color: string | null } }
export interface Offer { offerId: string; tripId: string; driverId: string; version: number; status: OfferStatus; createdAt: string; expiresAt: string; assignment: Assignment; command: Command }
export interface Candidate { driverId: string; observedAt: string; status: 'OK' | 'NO_ROUTE'; distanceMeters: number | null; durationSeconds: number | null }
export const terminal = (s: SearchStatus) => s === 'CANCELLED' || s === 'COMPLETED';
export const held = (s: OfferStatus) => ['PENDING', 'ASSIGNMENT_PENDING', 'ASSIGNED'].includes(s);
export class MatchingError extends Error { constructor(readonly code: string, readonly status = 409) { super(code); } }
export function decide(offer: Offer, search: Search, driverId: string, action: 'accept' | 'decline', now: number): OfferStatus {
  if (offer.driverId !== driverId) throw new MatchingError('FORBIDDEN', 403);
  if (offer.status !== 'PENDING' || search.status !== 'SEARCHING' || search.offerId !== offer.offerId || now >= Date.parse(offer.expiresAt)) throw new MatchingError('OFFER_CLOSED');
  return action === 'accept' ? 'ASSIGNMENT_PENDING' : 'DECLINED';
}
export function rank(candidates: Candidate[], tried: Set<string>, reserved: Set<string>, now: number): Candidate[] {
  return candidates.filter(c => uuid.safeParse(c.driverId).success && c.status === 'OK' && c.durationSeconds !== null && c.durationSeconds >= 0 && c.distanceMeters !== null && c.distanceMeters >= 0 && Number.isFinite(Date.parse(c.observedAt)) && now - Date.parse(c.observedAt) <= 30000 && Date.parse(c.observedAt) <= now + 5000 && !tried.has(c.driverId) && !reserved.has(c.driverId))
    .sort((a, b) => a.durationSeconds! - b.durationSeconds! || a.distanceMeters! - b.distanceMeters! || a.driverId.localeCompare(b.driverId));
}
