import { randomUUID } from 'node:crypto';
import type { RoutingRuntime } from '../bootstrap/runtime';
import { RoutingError } from '../domain/errors';
import { countFailure } from '../infrastructure/pipeline/metrics';
import type { Context } from '../application/ports/clients';
import { checkpoint } from '../application/context';
import { GrpcServer, header, loadService, type Failure, type UnaryCall } from '../infrastructure/grpc';
import { authorize } from './http';
/**
 * Routing's internal API over gRPC (proto/routing.proto): Estimate for Trip, EtaMatrix for Matching. Same token check,
 * same per-request deadline, same cancellation when the caller goes away, and same use cases (which validate the
 * request) as the HTTP controller, so the worker pool and rate limiter treat both transports alike.
 */
export function describe(error: unknown): Failure {
  const failure = error instanceof RoutingError ? error : new RoutingError('INTERNAL_ERROR', 500);
  countFailure(failure.code, failure.reason);
  return { status: failure.status, code: failure.code, retryAfter: failure.code === 'ROUTING_BUSY' ? '1' : null };
}
export function routingGrpc(runtime: RoutingRuntime): GrpcServer {
  const execute = async (call: UnaryCall, caller: 'trip' | 'matching', action: (context: Context) => Promise<unknown>) => {
    const started = runtime.clock.now();
    authorize(header(call, 'x-service-token'), runtime, caller);
    const controller = new AbortController(); const abort = () => controller.abort();
    const untrack = runtime.track(controller);
    const deadline = started + runtime.config.limits.deadline;
    const timer = setTimeout(abort, Math.max(1, deadline - runtime.clock.now()));
    call.on('cancelled', abort);
    try {
      const context = { requestId: header(call, 'x-request-id') ?? randomUUID(), deadline, signal: controller.signal };
      const data = await action(context); checkpoint(context, runtime.clock);
      return data;
    } finally { clearTimeout(timer); call.off('cancelled', abort); untrack(); }
  };
  return new GrpcServer(describe).add(loadService('routing.proto', 'chande.routing.v1.RoutingInternal'), {
    Estimate: (request: unknown, call) => execute(call, 'trip', ctx => runtime.route.estimate(request, ctx)),
    EtaMatrix: (request: unknown, call) => execute(call, 'matching', ctx => runtime.etaMatrix.execute(request, ctx)),
  });
}
