import type { z } from 'zod';
import type { CandidateClients, Clients } from '../application/ports';
import type { Config } from '../bootstrap/config';
import type { Assignment } from '../domain/models';
import type { BreakerOptions } from './circuit-breaker';
import { CircuitBreaker } from './circuit-breaker';
import { assignmentAck, candidates, eligibility, eta, locations, matchingState, sameIds, UpstreamError } from './clients';
import { CallError, GrpcClient, grpcAddress, loadService, nullable } from './grpc';
/**
 * Matching's calls to Realtime, Driver, Routing and Trip over gRPC (INTERNAL_TRANSPORT=grpc). Same interface,
 * same checks on what comes back and same errors (UpstreamError with dependency, code, Retry-After) as HttpClients.
 */
type Snapshot = { fullName: string; avatarUrl?: string } | null;
type VehicleSnapshot = { vehicleType: string; licensePlate: string; brand?: string; color?: string } | null;
const driverSnapshot = (s: Snapshot) => s ? { fullName: s.fullName, avatarUrl: nullable(s.avatarUrl) } : null;
const vehicleSnapshot = (s: VehicleSnapshot) => s ? { vehicleType: s.vehicleType, licensePlate: s.licensePlate, brand: nullable(s.brand), color: nullable(s.color) } : null;
type Dependency = 'realtime' | 'driver' | 'routing' | 'trip';
export class GrpcClients implements Clients, CandidateClients {
  private readonly clients: Record<Dependency, GrpcClient>;
  constructor(private readonly c: Config, breakerOptions: BreakerOptions = {}, env: NodeJS.ProcessEnv = process.env) {
    const client = (dependency: Dependency, file: string, service: string, url: string) =>
      new GrpcClient(loadService(file, service), grpcAddress(dependency, url, env), c.httpTimeout, new CircuitBreaker(dependency, breakerOptions));
    this.clients = {
      realtime: client('realtime', 'realtime.proto', 'chande.realtime.v1.RealtimeInternal', c.realtimeUrl),
      driver: client('driver', 'driver.proto', 'chande.driver.v1.DriverInternal', c.driverUrl),
      routing: client('routing', 'routing.proto', 'chande.routing.v1.RoutingInternal', c.routingUrl),
      trip: client('trip', 'trip.proto', 'chande.trip.v1.TripInternal', c.tripUrl),
    };
  }
  breaker(dependency: Dependency) { return this.clients[dependency].breaker; }
  close() { for (const client of Object.values(this.clients)) client.close(); }
  private async call<T>(dependency: Dependency, token: string, method: string, request: unknown, schema: z.ZodType<T>, map: (reply: never) => unknown = r => r): Promise<T> {
    let reply: unknown;
    try { reply = await this.clients[dependency].call(method, request, { 'x-service-token': token }); }
    catch (error) {
      if (error instanceof CallError) throw new UpstreamError(error.status, error.code, dependency, error.retryAfterMs);
      throw new UpstreamError(503, 'INVALID_RESPONSE', dependency);
    }
    const result = schema.safeParse((map as (r: unknown) => unknown)(reply));
    if (!result.success) throw new UpstreamError(503, 'INVALID_RESPONSE', dependency);
    return result.data;
  }
  async driver(id: string, type: string) {
    const data = await this.call('driver', this.c.driverToken, 'CheckEligibility', { driverId: id, vehicleType: type }, eligibility,
      (r: { driverId: string; profileEligible: boolean; desiredStatus: string; vehicleId?: string; driverSnapshot: Snapshot; vehicleSnapshot: VehicleSnapshot }) =>
        ({ driverId: r.driverId, profileEligible: r.profileEligible, desiredStatus: r.desiredStatus, vehicleId: nullable(r.vehicleId), driverSnapshot: driverSnapshot(r.driverSnapshot), vehicleSnapshot: vehicleSnapshot(r.vehicleSnapshot) }));
    if (data.driverId !== id) throw new UpstreamError(503, 'INVALID_RESPONSE', 'driver');
    return data;
  }
  async locations(pickup: { lat: number; lng: number }, limit: number) {
    const data = await this.call('realtime', this.c.realtimeToken, 'ListDriverLocations', { latitude: pickup.lat, longitude: pickup.lng, radiusMeters: 2000, limit }, locations);
    if (data.drivers.length > limit || new Set(data.drivers.map(d => d.driverId)).size !== data.drivers.length) throw new UpstreamError(503, 'INVALID_RESPONSE', 'realtime');
    return data.drivers;
  }
  async candidates(driverIds: string[], vehicleType: string) {
    const data = await this.call('driver', this.c.driverToken, 'CheckCandidates', { driverIds, vehicleType }, candidates,
      (r: { items: { driverId: string; eligible: boolean; reasons: string[]; vehicleId?: string; driverSnapshot: Snapshot; vehicleSnapshot: VehicleSnapshot }[] }) =>
        ({ items: r.items.map(i => ({ driverId: i.driverId, eligible: i.eligible, reasons: i.reasons, vehicleId: nullable(i.vehicleId), driverSnapshot: driverSnapshot(i.driverSnapshot), vehicleSnapshot: vehicleSnapshot(i.vehicleSnapshot) })) }));
    if (!sameIds(driverIds, data.items.map(i => i.driverId))) throw new UpstreamError(503, 'INVALID_RESPONSE', 'driver');
    return data.items;
  }
  async eta(destination: { lat: number; lng: number }, vehicleType: string, origins: { id: string; lat: number; lng: number }[]) {
    const data = await this.call('routing', this.c.routingToken, 'EtaMatrix', { destination: { lat: destination.lat, lng: destination.lng }, vehicleType, origins }, eta,
      (r: { entries: { id: string; status: string; distanceMeters?: number; durationSeconds?: number }[]; calculatedAt: string }) =>
        ({ entries: r.entries.map(e => ({ id: e.id, status: e.status, distanceMeters: nullable(e.distanceMeters), durationSeconds: nullable(e.durationSeconds) })), calculatedAt: r.calculatedAt }));
    if (!sameIds(origins.map(o => o.id), data.entries.map(e => e.id))) throw new UpstreamError(503, 'INVALID_RESPONSE', 'routing');
    return data.entries;
  }
  async assign(tripId: string, assignment: Assignment) {
    const ack = await this.call('trip', this.c.tripToken, 'AssignTrip', { tripId, ...assignment }, assignmentAck);
    if (ack.eventId !== assignment.eventId || ack.tripId !== tripId) throw new UpstreamError(503, 'INVALID_RESPONSE', 'trip');
  }
  async trip(id: string) {
    // `found: false` is `data: null` over HTTP, which the HTTP client also rejects as an invalid answer.
    const data = await this.call('trip', this.c.tripToken, 'GetMatchingState', { tripId: id }, matchingState,
      (r: { found: boolean; tripId: string; status: string; driverId?: string; version: number }) => r.found ? { tripId: r.tripId, status: r.status, driverId: nullable(r.driverId), version: r.version } : null);
    if (data.tripId !== id) throw new UpstreamError(503);
    return data;
  }
}
