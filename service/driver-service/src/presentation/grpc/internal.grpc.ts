import { DriverContext } from "../../bootstrap/modules/driver-context";
import { DriverError } from "../../domain/value-objects/error";
import {
  GrpcServer,
  header,
  loadService,
  sameToken,
  type UnaryCall,
} from "../../infrastructure/grpc";
import { describeError } from "../http/filters/error.filter";
/**
 * Driver's internal API over gRPC (proto/driver.proto), for Matching. Same service token, same input rules as the
 * HTTP DTOs (CandidatesDto, EligibilityQuery, ParseUUIDPipe) and same use cases as InternalController.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VEHICLE_TYPE = /^[A-Za-z0-9_-]{1,20}$/;
const invalid = () => new DriverError("INVALID_REQUEST");
export function driverGrpc(context: DriverContext): GrpcServer {
  const matching = (call: UnaryCall) => {
    if (!sameToken(header(call, "x-service-token"), context.config.matchingToken))
      throw new DriverError("INVALID_SERVICE_CREDENTIAL");
  };
  const vehicleType = (value: unknown) => {
    if (typeof value !== "string" || !VEHICLE_TYPE.test(value)) throw invalid();
    return value;
  };
  return new GrpcServer((error) => {
    const { status, code } = describeError(error);
    return { status, code, retryAfter: status === 429 ? "60" : status === 503 ? "1" : null };
  }).add(loadService("driver.proto", "chande.driver.v1.DriverInternal"), {
    CheckCandidates: async (r: { driverIds: string[]; vehicleType: string }, call) => {
      matching(call);
      const ids = r.driverIds;
      if (ids.length < 1 || ids.length > 100 || new Set(ids).size !== ids.length || !ids.every((id) => UUID.test(id))) throw invalid();
      return context.candidates.execute(ids, vehicleType(r.vehicleType));
    },
    CheckEligibility: async (r: { driverId: string; vehicleType: string }, call) => {
      matching(call);
      if (!UUID.test(r.driverId)) throw invalid();
      return context.eligibility.eligibility(r.driverId, vehicleType(r.vehicleType));
    },
  });
}
