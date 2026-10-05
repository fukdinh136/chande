import { z } from 'zod';
import { DomainError } from '../domain/error';
export const uuid = z.uuid().transform(value => value.toLowerCase());
export const location = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), address: z.string().trim().min(1).max(500).optional() }).strict();
export const estimateBody = z.object({ pickup: location, destination: location, vehicleType: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/) }).strict();
export const createBody = z.object({ quoteId: uuid }).strict();
export const updateBody = z.object({ status: z.enum(['DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED']), version: z.number().int().min(1).max(2147483647) }).strict();
export const cancelBody = z.object({ reason: z.string().trim().min(1).max(500), version: z.number().int().min(1).max(2147483647) }).strict();
export const assignmentBody = z.object({ eventId: uuid, driverId: uuid, vehicleId: uuid,
  driverSnapshot: z.object({ fullName: z.string().trim().min(1).max(100), avatarUrl: z.url({ protocol: /^https$/ }).nullable() }).strict(),
  vehicleSnapshot: z.object({ vehicleType: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), licensePlate: z.string().trim().min(1).max(32), brand: z.string().trim().min(1).max(100).nullable(), color: z.string().trim().min(1).max(100).nullable() }).strict(),
}).strict();
export const historyQuery = z.object({ limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).pipe(z.number().max(100)).optional(), status: z.enum(['COMPLETED', 'CANCELLED']).optional(), cursor: z.string().min(1).max(2048).optional() }).strict();
export function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw new DomainError('INVALID_REQUEST'); return result.data; }
const id = z.uuid(); const date = z.iso.datetime(); const amount = z.string().regex(/^(0|[1-9]\d{0,18})$/);
const route = z.object({ distanceMeters: z.number().int().min(0).max(2147483647), durationSeconds: z.number().int().min(0).max(2147483647) });
const breakdown = z.array(z.object({ code: z.string(), amount }));
export const quoteResponse = estimateBody.extend({ quoteId: id, route, fare: z.object({ currency: z.literal('VND'), amount, breakdown }), createdAt: date, expiresAt: date });
const status = z.enum(['CREATED', 'SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export const tripResponse = z.object({ tripId: id, quoteId: id, riderId: id, driverId: id.nullable(), vehicleId: id.nullable(), status, version: z.number().int().min(0), pickup: location, destination: location, vehicleType: z.string(), route,
  fare: z.object({ currency: z.literal('VND'), estimatedAmount: amount, finalAmount: amount.nullable(), breakdown }),
  driver: assignmentBody.shape.driverSnapshot.extend({ driverId: id }).nullable(), vehicle: assignmentBody.shape.vehicleSnapshot.extend({ vehicleId: id }).nullable(),
  timestamps: z.object({ requestedAt: date, assignedAt: date.nullable(), driverArrivedAt: date.nullable(), startedAt: date.nullable(), completedAt: date.nullable(), cancelledAt: date.nullable() }),
  cancellation: z.object({ actorType: z.enum(['RIDER', 'DRIVER']), actorId: id, reason: z.string(), cancelledAt: date }).nullable(),
});
export const detailResponse = z.object({ trip: tripResponse, statusHistory: z.array(z.object({ fromStatus: status.nullable(), toStatus: status, actorType: z.enum(['RIDER', 'DRIVER', 'SYSTEM']), actorId: id.nullable(), occurredAt: date, version: z.number().int().min(0) })) });
export const pageResponse = z.object({ items: z.array(tripResponse), nextCursor: z.string().nullable() });
export const assignmentResponse = z.object({ eventId: id, tripId: id, accepted: z.literal(true), assignedVersion: z.number().int().min(2) });
export const errorResponse = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.array(z.unknown()) }), meta: z.object({ requestId: id }) });
export function responseEnvelope(data: z.ZodType) { return z.object({ data, meta: z.object({ requestId: id }) }); }
