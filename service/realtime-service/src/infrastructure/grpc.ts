import { randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import { CircuitBreaker, failedStatus } from './circuit-breaker';
/**
 * Internal gRPC between the Node services: loading proto/, the server side, and a client with a circuit breaker.
 * The same file is copied into every Node service; keep the copies identical.
 *
 * Errors keep the HTTP meaning on both sides. A server reports a failure as a gRPC status plus trailing metadata
 * `x-http-status`, `x-error-code` and `retry-after`, and the client turns it back into the same status, error code
 * and Retry-After the HTTP API gives. So retry rules, breakers and error handling work alike over both transports.
 */
export type Transport = 'http' | 'grpc';
/** INTERNAL_TRANSPORT picks how this service calls the others: `http` (default) or `grpc`. */
export function internalTransport(env: NodeJS.ProcessEnv = process.env): Transport {
  const value = env.INTERNAL_TRANSPORT ?? 'http';
  if (value !== 'http' && value !== 'grpc') throw new Error('INTERNAL_TRANSPORT must be http or grpc');
  return value;
}
export type ServiceName = 'trip' | 'matching' | 'driver' | 'realtime' | 'routing' | 'price';
/** Default gRPC port of each service; distinct so that services running on one host do not collide. */
export const GRPC_PORTS: Record<ServiceName, number> = { trip: 50051, matching: 50052, driver: 50053, realtime: 50054, routing: 50055, price: 50056 };
/** The port this service serves gRPC on: GRPC_PORT, else its default. */
export function grpcPort(service: ServiceName, env: NodeJS.ProcessEnv = process.env): number {
  const port = Number(env.GRPC_PORT ?? GRPC_PORTS[service]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('GRPC_PORT must be a port number');
  return port;
}
/** Where a dependency serves gRPC: <SERVICE>_GRPC_ADDRESS, else the host of its HTTP URL and its default gRPC port. */
export function grpcAddress(service: ServiceName, httpUrl: string, env: NodeJS.ProcessEnv = process.env): string {
  return env[`${service.toUpperCase()}_GRPC_ADDRESS`] || `${new URL(httpUrl).hostname}:${GRPC_PORTS[service]}`;
}
const PROTO_OPTIONS: loader.Options = { keepCase: false, longs: Number, enums: String, defaults: true, oneofs: false };
/** Loads one service from proto/, e.g. `loadService('trip.proto', 'chande.trip.v1.TripInternal')`. */
export function loadService(file: string, name: string, dir = process.env.GRPC_PROTO_DIR ?? join(process.cwd(), 'proto')): grpc.ServiceClientConstructor {
  const definition = grpc.loadPackageDefinition(loader.loadSync(join(dir, file), { ...PROTO_OPTIONS, includeDirs: [dir] }));
  const found = name.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], definition);
  if (typeof found !== 'function') throw new Error(`gRPC service ${name} not found in ${file}`);
  return found as grpc.ServiceClientConstructor;
}
/** proto3 leaves an unset `optional` field out; the HTTP API has null there. */
export const nullable = <T>(value: T | undefined | null): T | null => value ?? null;
/** A failure the way the HTTP API reports it. */
export interface Failure { status: number; code: string; retryAfter?: string | null }
const MAX_MESSAGE = 1024 * 1024;
const toGrpc = (status: number): grpc.status =>
  status === 400 || status === 413 || status === 422 ? grpc.status.INVALID_ARGUMENT
    : status === 401 ? grpc.status.UNAUTHENTICATED : status === 403 ? grpc.status.PERMISSION_DENIED
      : status === 404 ? grpc.status.NOT_FOUND : status === 409 ? grpc.status.FAILED_PRECONDITION
        : status === 429 ? grpc.status.RESOURCE_EXHAUSTED : status === 503 ? grpc.status.UNAVAILABLE
          : status === 504 ? grpc.status.DEADLINE_EXCEEDED : grpc.status.INTERNAL;
function serviceError(failure: Failure): Partial<grpc.ServiceError> {
  const metadata = new grpc.Metadata();
  metadata.set('x-http-status', String(failure.status)); metadata.set('x-error-code', failure.code);
  if (failure.retryAfter) metadata.set('retry-after', failure.retryAfter);
  return { code: toGrpc(failure.status), details: failure.code, metadata };
}
/** First value of a request metadata key, as a string. */
export function header(call: { metadata: grpc.Metadata }, key: string): string | undefined {
  const value = call.metadata.get(key)[0];
  return typeof value === 'string' ? value : undefined;
}
/** Compares a service token in constant time; an empty expected token never matches. */
export function sameToken(actual: string | undefined, expected: string): boolean {
  const a = Buffer.from(actual ?? ''), b = Buffer.from(expected);
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
export type UnaryCall = grpc.ServerUnaryCall<unknown, unknown>;
export type Handler = (request: never, call: UnaryCall) => Promise<unknown>;
/** gRPC server for this service's internal API. `describe` maps a thrown error the same way the HTTP error filter does. */
export class GrpcServer {
  private readonly server = new grpc.Server({ 'grpc.max_receive_message_length': MAX_MESSAGE, 'grpc.max_send_message_length': MAX_MESSAGE });
  constructor(private readonly describe: (error: unknown) => Failure) {}
  add(service: grpc.ServiceClientConstructor, handlers: Record<string, Handler>): this {
    const implementation: grpc.UntypedServiceImplementation = {};
    for (const [method, handler] of Object.entries(handlers)) {
      implementation[method] = (call: UnaryCall, callback: grpc.sendUnaryData<unknown>) => {
        (handler as (request: unknown, call: UnaryCall) => Promise<unknown>)(call.request, call)
          .then(reply => { callback(null, reply); }, (error: unknown) => { callback(serviceError(this.describe(error))); });
      };
    }
    this.server.addService(service.service, implementation);
    return this;
  }
  /** Starts listening; returns the bound port (useful with port 0 in tests). */
  listen(host: string, port: number): Promise<number> {
    return new Promise((resolve, reject) => { this.server.bindAsync(`${host.includes(':') ? `[${host}]` : host}:${port}`, grpc.ServerCredentials.createInsecure(), (error, bound) => { if (error) reject(error); else resolve(bound); }); });
  }
  /** Stops taking calls, lets running calls finish for up to `graceMs`, then cuts the rest. */
  close(graceMs = 10000): Promise<void> {
    return new Promise(resolve => {
      const force = setTimeout(() => { this.server.forceShutdown(); resolve(); }, graceMs); force.unref();
      this.server.tryShutdown(() => { clearTimeout(force); resolve(); });
    });
  }
}
/** A failed call: the HTTP status it stands for (0 when there was no answer), the error code and Retry-After in ms. */
export class CallError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryAfterMs: number | null = null) { super(code); }
}
function callError(error: grpc.ServiceError): CallError {
  const status = Number(error.metadata?.get('x-http-status')[0]);
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    const code = String(error.metadata.get('x-error-code')[0] ?? `HTTP_${status}`);
    const after = Number(error.metadata.get('retry-after')[0]);
    return new CallError(status, /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : `HTTP_${status}`, Number.isFinite(after) && after > 0 ? Math.min(after, 60) * 1000 : null);
  }
  // No answer from the service itself: the connection, the deadline or the gRPC runtime failed.
  if (error.code === grpc.status.DEADLINE_EXCEEDED) return new CallError(0, 'TIMEOUT');
  if (error.code === grpc.status.UNAVAILABLE || error.code === grpc.status.CANCELLED) return new CallError(0, 'UNREACHABLE');
  if (error.code === grpc.status.RESOURCE_EXHAUSTED) return new CallError(503, 'RESPONSE_TOO_LARGE');
  return new CallError(error.code === grpc.status.UNIMPLEMENTED ? 501 : 500, `GRPC_${grpc.status[error.code] ?? 'ERROR'}`);
}
/** Client of one dependency over one long-lived HTTP/2 connection, with its own circuit breaker (D1). */
export class GrpcClient {
  private readonly client: grpc.Client;
  constructor(service: grpc.ServiceClientConstructor, address: string, private readonly timeoutMs: number, readonly breaker: CircuitBreaker) {
    this.client = new service(address, grpc.credentials.createInsecure(), { 'grpc.max_receive_message_length': MAX_MESSAGE, 'grpc.max_send_message_length': MAX_MESSAGE, 'grpc.keepalive_time_ms': 30000 });
  }
  /**
   * Calls `method` with a deadline of `timeoutMs`. Rejects with CallError; CIRCUIT_OPEN (503, Retry-After until the
   * breaker's next trial) while the breaker is open. `metadata` adds headers such as x-service-token or authorization.
   */
  call<T>(method: string, request: unknown, metadata: Record<string, string> = {}, timeoutMs = this.timeoutMs): Promise<T> {
    const wait = this.breaker.acquire();
    if (wait > 0) return Promise.reject(new CallError(503, 'CIRCUIT_OPEN', wait));
    const headers = new grpc.Metadata();
    headers.set('x-request-id', randomUUID());
    for (const [key, value] of Object.entries(metadata)) headers.set(key, value);
    const fn = (this.client as unknown as Record<string, (r: unknown, m: grpc.Metadata, o: grpc.CallOptions, cb: (e: grpc.ServiceError | null, v: T) => void) => void>)[method];
    if (!fn) return Promise.reject(new Error(`unknown gRPC method ${method}`));
    return new Promise<T>((resolve, reject) => {
      fn.call(this.client, request, headers, { deadline: Date.now() + timeoutMs }, (error: grpc.ServiceError | null, reply: T) => {
        if (!error) { this.breaker.success(); resolve(reply); return; }
        const failure = callError(error);
        if (failure.status === 0 || failedStatus(failure.status, failure.retryAfterMs === null ? null : String(failure.retryAfterMs))) this.breaker.failure(); else this.breaker.success();
        reject(failure);
      });
    });
  }
  close() { this.client.close(); }
}
