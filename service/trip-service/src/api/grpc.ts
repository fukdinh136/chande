import { z } from 'zod';
import type { TripContext } from '../bootstrap/context';
import { DomainError } from '../domain/error';
import { GrpcServer, header, loadService, nullable, type Failure, type UnaryCall } from '../infrastructure/grpc';
import { verifyServiceCredential } from './auth';
import { codes } from './http';
import { assignmentBody, parse, uuid } from './schemas';
/**
 * Trip's internal API over gRPC (proto/trip.proto). Each method checks the same credential, validates with the same
 * schema and calls the same use case as its HTTP twin in controllers.ts, so both transports behave alike.
 */
const driverIds = z.object({ driverIds: z.array(uuid).min(1).max(100).refine(ids => new Set(ids).size === ids.length) }).strict();
/** The same mapping as the HTTP error filter, including Retry-After: 1 on 503. */
export function describe(error: unknown): Failure {
  const status = error instanceof DomainError ? codes[error.code] ?? 500 : 500;
  const code = error instanceof DomainError && codes[error.code] ? error.code : 'INTERNAL_ERROR';
  return { status, code, retryAfter: status === 503 ? '1' : null };
}
type Snapshot = { fullName: string; avatarUrl?: string } | null;
type VehicleSnapshot = { vehicleType: string; licensePlate: string; brand?: string; color?: string } | null;
type AssignRequest = { tripId: string; eventId: string; driverId: string; vehicleId: string; driverSnapshot: Snapshot; vehicleSnapshot: VehicleSnapshot };
export function tripGrpc(context: TripContext): GrpcServer {
  const service = (call: UnaryCall, token: string | undefined) => { verifyServiceCredential(header(call, 'x-service-token'), token ?? ''); };
  return new GrpcServer(describe).add(loadService('trip.proto', 'chande.trip.v1.TripInternal'), {
    AssignTrip: async (r: AssignRequest, call) => {
      service(call, context.config.callbackToken);
      const input = parse(assignmentBody, { eventId: r.eventId, driverId: r.driverId, vehicleId: r.vehicleId,
        driverSnapshot: r.driverSnapshot && { fullName: r.driverSnapshot.fullName, avatarUrl: nullable(r.driverSnapshot.avatarUrl) },
        vehicleSnapshot: r.vehicleSnapshot && { vehicleType: r.vehicleSnapshot.vehicleType, licensePlate: r.vehicleSnapshot.licensePlate, brand: nullable(r.vehicleSnapshot.brand), color: nullable(r.vehicleSnapshot.color) } });
      return (await context.assignment.execute(parse(uuid, r.tripId), input)).value;
    },
    GetMatchingState: async (r: { tripId: string }, call) => {
      service(call, context.config.callbackToken);
      const trip = await context.store.transaction(tx => tx.findTrip(parse(uuid, r.tripId)));
      return trip ? { found: true, tripId: trip.tripId, status: trip.status, driverId: trip.driverId ?? undefined, version: trip.version } : { found: false };
    },
    ActiveDriverTrips: async (r: { driverIds: string[] }, call) => {
      service(call, context.config.driverLookupToken);
      const ids = parse(driverIds, r).driverIds;
      const active = await context.store.transaction(tx => tx.activeTripsByDriver(ids));
      return { items: ids.map(driverId => ({ driverId, tripId: active.get(driverId) ?? undefined })) };
    },
    GetActiveTrip: async (_r: unknown, call) => {
      const trip = await context.get.active(await context.identity.verify(header(call, 'authorization')));
      return { trip: trip ? { tripId: trip.tripId, vehicleId: trip.vehicleId ?? undefined, status: trip.status, version: trip.version } : undefined };
    },
  });
}
