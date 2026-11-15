import { z } from 'zod';
import { GrpcServer, header, loadService, nullable, type Failure, type UnaryCall } from '../infrastructure/grpc';
import { publicOffer } from '../application/match';
import { cancelCommand, completedEvent, MatchingError, searchCommand, uuid } from '../domain/models';
import { credential } from './auth';
import { parse, type Context } from './app';
/**
 * Matching's internal API over gRPC (proto/matching.proto). Each method checks the same service token, validates
 * with the same schema and calls the same use case as its HTTP twin in app.ts, so both transports behave alike.
 */
const batchBody = z.object({ driverIds: z.array(uuid).min(1).max(100).refine(ids => new Set(ids).size === ids.length) }).strict();
/** The same mapping as the HTTP error filter. */
export function describe(error: unknown): Failure {
  if (error instanceof MatchingError) return { status: error.status, code: error.code };
  return { status: 503, code: 'DEPENDENCY_UNAVAILABLE' };
}
export function matchingGrpc(c: Context): GrpcServer {
  const from = (call: UnaryCall, token: string) => { credential(header(call, 'x-service-token'), token); };
  return new GrpcServer(describe).add(loadService('matching.proto', 'chande.matching.v1.MatchingInternal'), {
    StartSearch: async (request: Record<string, unknown>, call) => {
      from(call, c.config.tokens.trip);
      return c.commands.search(parse(searchCommand, request));
    },
    CancelSearch: async (request: Record<string, unknown>, call) => {
      from(call, c.config.tokens.trip);
      const input = parse(cancelCommand, request);
      return c.commands.stop(input.commandId, input.tripId, input, 'CANCELLED');
    },
    TripCompleted: async (request: Record<string, unknown> & { data: { driverId?: string } | null }, call) => {
      from(call, c.config.tokens.trip);
      const input = parse(completedEvent, { ...request, data: request.data && { ...request.data, driverId: nullable(request.data.driverId) } });
      return c.commands.stop(input.eventId, input.tripId, input, 'COMPLETED');
    },
    DriverReservations: async (request: { driverIds: string[] }, call) => {
      from(call, c.config.tokens.driver);
      return { items: await c.repo.reservations(parse(batchBody, request).driverIds) };
    },
    GetOffer: async (request: { offerId: string }, call) => {
      from(call, c.config.tokens.realtime);
      const o = await c.repo.getOffer(parse(uuid, request.offerId));
      if (!o) throw new MatchingError('NOT_FOUND', 404);
      return publicOffer(o);
    },
    DriverOffer: async (request: { driverId: string }, call) => {
      from(call, c.config.tokens.realtime);
      return { offer: publicOffer(await c.repo.activeOffer(parse(uuid, request.driverId))) ?? undefined };
    },
  });
}
