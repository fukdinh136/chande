import { z } from 'zod';
import type { PricingPort, RoutingPort } from '../../application/ports/clients';
import type { Location, QuoteFare, RouteSummary } from '../../domain/models';
import { DomainError } from '../../domain/error';
import { validateEstimate } from '../../domain/quote';
import type { Config } from '../../bootstrap/config';
import { CircuitBreaker } from '../circuit-breaker';
import { CallError, GrpcClient, grpcAddress, loadService, type ServiceName } from '../grpc';
import { TransportError } from './http';
import { routeSchema } from './routing';
import { fareSchema } from './pricing';
/**
 * Trip's calls to Routing, Price and Matching over gRPC (INTERNAL_TRANSPORT=grpc). Same ports, same checks on what
 * comes back and same errors as the HTTP clients: estimates fail as DEPENDENCY_UNAVAILABLE, outbox deliveries as
 * TransportError (retryable when there was no answer, 429 or 5xx).
 */
const SERVICES: Partial<Record<ServiceName, [string, string]>> = {
  routing: ['routing.proto', 'chande.routing.v1.RoutingInternal'], price: ['price.proto', 'chande.price.v1.PriceInternal'], matching: ['matching.proto', 'chande.matching.v1.MatchingInternal'],
};
export function grpcClient(service: 'routing' | 'price' | 'matching', httpUrl: string, config: Pick<Config, 'httpTimeout'>, env: NodeJS.ProcessEnv = process.env): GrpcClient {
  const [file, name] = SERVICES[service]!;
  return new GrpcClient(loadService(file, name), grpcAddress(service, httpUrl, env), config.httpTimeout, new CircuitBreaker(service));
}
/** The TransportError an HTTP call with the same outcome gives, so the outbox retries and blocks alike. */
export function transportError(error: unknown): TransportError {
  if (!(error instanceof CallError)) return new TransportError(true, 'NETWORK_ERROR');
  if (error.status === 0) return new TransportError(true, error.code === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK_ERROR');
  return new TransportError(error.status === 429 || error.status >= 500, error.code);
}
async function call<T>(client: GrpcClient, method: string, request: unknown, token: string, requestId: string, schema: z.ZodType<T>): Promise<T> {
  let reply: unknown;
  try { reply = await client.call(method, request, { 'x-service-token': token, 'x-request-id': requestId }); }
  catch (error) { throw transportError(error); }
  const parsed = schema.safeParse(reply);
  if (!parsed.success) throw new TransportError(false, 'INVALID_RESPONSE');
  return parsed.data;
}
export class GrpcRoutingClient implements RoutingPort {
  constructor(private readonly client: GrpcClient, private readonly token: string) {}
  async estimate(pickup: Location, destination: Location, vehicleType: string, requestId: string): Promise<RouteSummary> {
    try { return await call(this.client, 'Estimate', { pickup, destination, vehicleType }, this.token, requestId, routeSchema); }
    catch { throw new DomainError('DEPENDENCY_UNAVAILABLE'); }
  }
}
export class GrpcPricingClient implements PricingPort {
  constructor(private readonly client: GrpcClient, private readonly token: string) {}
  async estimate(route: RouteSummary, vehicleType: string, requestId: string): Promise<QuoteFare> {
    try { const fare = await call(this.client, 'EstimateFare', { route, vehicleType }, this.token, requestId, fareSchema); validateEstimate(route, fare); return fare; }
    catch { throw new DomainError('DEPENDENCY_UNAVAILABLE'); }
  }
}
const commandAck = z.object({ commandId: z.uuid(), accepted: z.literal(true) }).strict();
const eventAck = z.object({ eventId: z.uuid(), accepted: z.literal(true) }).strict();
/** Outbox deliveries to Matching: search and cancel commands, and the trip.completed event. */
export class GrpcMatchingClient {
  constructor(private readonly client: GrpcClient, private readonly token: string) {}
  async send(kind: 'search' | 'cancel', payload: Record<string, unknown>, requestId: string): Promise<void> {
    const ack = await call(this.client, kind === 'search' ? 'StartSearch' : 'CancelSearch', payload, this.token, requestId, commandAck);
    if (ack.commandId !== payload.commandId) throw new TransportError(false, 'INVALID_ACK');
  }
  async event(payload: Record<string, unknown>, requestId: string): Promise<void> {
    // Matching accepts only trip.completed; over HTTP any other event is a 400 that blocks the delivery.
    if (payload.type !== 'trip.completed') throw new TransportError(false, 'INVALID_REQUEST');
    const ack = await call(this.client, 'TripCompleted', payload, this.token, requestId, eventAck);
    if (ack.eventId !== payload.eventId) throw new TransportError(false, 'INVALID_ACK');
  }
}
