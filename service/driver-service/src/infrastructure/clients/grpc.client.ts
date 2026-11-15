import { Occupancy } from "../../application/ports/occupancy.port";
import { TripActive } from "../../application/ports/trip-active.port";
import { DriverError } from "../../domain/value-objects/error";
import { CircuitBreaker, type BreakerOptions } from "../circuit-breaker";
import { CallError, GrpcClient, grpcAddress, loadService } from "../grpc";
/**
 * Driver's calls to Trip and Matching over gRPC (INTERNAL_TRANSPORT=grpc). Same ports, same checks on what comes
 * back and same errors as HttpOccupancy and HttpTripActive.
 */
const UUID = /^[0-9a-f-]{36}$/i;
export const tripClient = (tripUrl: string, timeout: number, options: BreakerOptions = {}, env: NodeJS.ProcessEnv = process.env) =>
  new GrpcClient(loadService("trip.proto", "chande.trip.v1.TripInternal"), grpcAddress("trip", tripUrl, env), timeout, new CircuitBreaker("trip", options));
export const matchingClient = (matchingUrl: string, timeout: number, options: BreakerOptions = {}, env: NodeJS.ProcessEnv = process.env) =>
  new GrpcClient(loadService("matching.proto", "chande.matching.v1.MatchingInternal"), grpcAddress("matching", matchingUrl, env), timeout, new CircuitBreaker("matching", options));
type Rows = { items?: { driverId: string; tripId?: string }[] };
export class GrpcOccupancy implements Occupancy {
  constructor(private readonly trip: GrpcClient, private readonly tripToken: string, private readonly matching: GrpcClient, private readonly matchingToken: string) {}
  get breakers() { return { trip: this.trip.breaker, matching: this.matching.breaker }; }
  async lookup(ids: readonly string[]) {
    const call = async (client: GrpcClient, method: string, token: string) => {
      const reply = await client.call<Rows>(method, { driverIds: ids }, { "x-service-token": token });
      const rows = (reply.items ?? []).map((r) => ({ driverId: r.driverId, tripId: r.tripId ?? null }));
      if (rows.length !== ids.length || new Set(rows.map((r) => r.driverId)).size !== ids.length || rows.some((r) => !ids.includes(r.driverId) || !(r.tripId === null || UUID.test(r.tripId))))
        throw new DriverError("DEPENDENCY_UNAVAILABLE");
      return rows;
    };
    try {
      const [trips, reservations] = await Promise.all([call(this.trip, "ActiveDriverTrips", this.tripToken), call(this.matching, "DriverReservations", this.matchingToken)]);
      return new Map(ids.map((id) => [id, trips.some((r) => r.driverId === id && r.tripId !== null) || reservations.some((r) => r.driverId === id && r.tripId !== null)]));
    } catch {
      throw new DriverError("DEPENDENCY_UNAVAILABLE");
    }
  }
}
const OPEN = ["CREATED", "SEARCHING", "ASSIGNED", "DRIVER_ARRIVED", "IN_PROGRESS"];
export class GrpcTripActive implements TripActive {
  constructor(private readonly trip: GrpcClient) {}
  get breaker() { return this.trip.breaker; }
  async active(authorization: string) {
    let reply: { trip?: { tripId: string; vehicleId?: string; status: string; version: number } };
    try {
      reply = await this.trip.call("GetActiveTrip", {}, { authorization });
    } catch (error) {
      if (error instanceof CallError && error.status === 401) throw new DriverError("UNAUTHENTICATED");
      if (error instanceof CallError && error.status === 403) throw new DriverError("FORBIDDEN_ACTION");
      throw new DriverError("DEPENDENCY_UNAVAILABLE");
    }
    const trip = reply.trip;
    if (!trip) return null;
    if (!UUID.test(trip.tripId) || !OPEN.includes(trip.status) || !Number.isInteger(trip.version)) throw new DriverError("DEPENDENCY_UNAVAILABLE");
    return { tripId: trip.tripId, vehicleId: trip.vehicleId ?? null };
  }
}
