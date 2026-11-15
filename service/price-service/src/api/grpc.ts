import type { Config } from '../bootstrap/config';
import { FareError } from '../domain/fare';
import type { CalculateFare } from '../application/calculate';
import { GrpcServer, header, loadService, sameToken, type Failure } from '../infrastructure/grpc';
/**
 * Price's internal API over gRPC (proto/price.proto), for Trip. Same service token and same use case as
 * POST /internal/fares/estimate; the use case validates the request.
 */
export function describe(error: unknown): Failure {
  return error instanceof FareError ? { status: error.status, code: error.code } : { status: 500, code: 'INTERNAL_ERROR' };
}
export function priceGrpc(config: Pick<Config, 'token'>, fare: CalculateFare): GrpcServer {
  return new GrpcServer(describe).add(loadService('price.proto', 'chande.price.v1.PriceInternal'), {
    EstimateFare: async (request: unknown, call) => {
      if (!sameToken(header(call, 'x-service-token'), config.token)) throw new FareError('INVALID_SERVICE_CREDENTIAL', 401);
      return fare.execute(request);
    },
  });
}
