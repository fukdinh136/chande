import type { Request } from 'express';
import type { ListDriverLocations } from '../../application/use-cases/list-driver-locations';
import { RealtimeError } from '../../domain/errors';
import { GrpcServer, header, loadService, type UnaryCall } from '../../infrastructure/grpc';
import { requireServiceCredential } from '../http/guards/service-credential';
import { statusFor } from '../http/response';
/**
 * Realtime's internal API over gRPC (proto/realtime.proto), for Matching. Same service token check and same use case
 * as DriverLocationsController; the use case itself validates the numbers, as it does for the HTTP query.
 */
type Query = { latitude: number; longitude: number; radiusMeters?: number; limit?: number };
export function realtimeGrpc(list: ListDriverLocations, credential: string): GrpcServer {
  const matching = (call: UnaryCall) => { requireServiceCredential({ header: (name: string) => name === 'X-Service-Token' ? header(call, 'x-service-token') : undefined } as unknown as Request, credential); };
  return new GrpcServer(error => {
    const code = error instanceof RealtimeError ? error.code : 'INTERNAL_ERROR', status = statusFor(code);
    return { status, code, retryAfter: status === 503 ? '1' : null };
  }).add(loadService('realtime.proto', 'chande.realtime.v1.RealtimeInternal'), {
    ListDriverLocations: async (r: Query, call) => {
      matching(call);
      return list.execute({ latitude: r.latitude, longitude: r.longitude, radiusMeters: r.radiusMeters, limit: r.limit });
    },
  });
}
