import { TripActive } from "../../application/ports/trip-active.port";
import { DriverError } from "../../domain/value-objects/error";
import { CircuitBreaker, failedStatus } from "../circuit-breaker";
export class HttpTripActive implements TripActive {
  constructor(
    private readonly url: string,
    private readonly timeout: number,
    /** Breaker for Trip (D1): while open, the check fails at once with DEPENDENCY_UNAVAILABLE. */
    readonly breaker = new CircuitBreaker("trip"),
  ) {}
  async active(authorization: string) {
    try {
      if (this.breaker.acquire() > 0) throw new Error("circuit open");
      let response: Response;
      try {
        response = await fetch(`${this.url}/trips/active`, {
          headers: { Authorization: authorization },
          signal: AbortSignal.timeout(this.timeout),
        });
      } catch (error) {
        this.breaker.failure();
        throw error;
      }
      if (failedStatus(response.status, response.headers.get("retry-after")))
        this.breaker.failure();
      else this.breaker.success();
      if (response.status === 401) throw new DriverError("UNAUTHENTICATED");
      if (response.status === 403) throw new DriverError("FORBIDDEN_ACTION");
      if (!response.ok) throw new Error("trip");
      const body = (await response.json()) as {
        data?: {
          tripId: string;
          vehicleId: string | null;
          status: string;
          version: number;
        } | null;
      };
      if (body.data === null) return null;
      if (
        !body.data ||
        !/^[0-9a-f-]{36}$/i.test(body.data.tripId) ||
        ![
          "CREATED",
          "SEARCHING",
          "ASSIGNED",
          "DRIVER_ARRIVED",
          "IN_PROGRESS",
        ].includes(body.data.status) ||
        !Number.isInteger(body.data.version)
      )
        throw new Error("contract");
      return { tripId: body.data.tripId, vehicleId: body.data.vehicleId };
    } catch (error) {
      if (error instanceof DriverError) throw error;
      throw new DriverError("DEPENDENCY_UNAVAILABLE");
    }
  }
}
