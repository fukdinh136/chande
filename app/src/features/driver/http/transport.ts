import { fetch } from 'expo/fetch';
import type { HttpConfig, Service } from './config';
import { ApiError } from './errors';
import { object } from '../contracts/decode';

export interface RequestSpec {
  service: Service;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  body?: unknown;
  key?: string;
  query?: Record<string, string>;
  signal?: AbortSignal;
}
export interface HttpResult { data: unknown; replayed: boolean }
export interface HttpTransport {
  send(request: RequestSpec, accessToken?: string): Promise<HttpResult>;
}
export class FetchTransport implements HttpTransport {
  constructor(private readonly config: HttpConfig) {}
  async send(request: RequestSpec, accessToken?: string): Promise<HttpResult> {
    const base = request.service === 'driver' ? this.config.driverBase : this.config.tripBase;
    if (!base) throw new ApiError('TRIP_NOT_CONFIGURED');
    if (!/^\/[A-Za-z0-9/_-]+$/.test(request.path) || request.path.includes('//')) throw new ApiError('INVALID_ROUTE');
    const url = new URL(`${base}${request.path}`);
    for (const [key, value] of Object.entries(request.query ?? {})) url.searchParams.set(key, value);
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    request.signal?.addEventListener('abort', cancel, { once: true });
    if (request.signal?.aborted) cancel();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.config.timeoutMs);
    try {
      const response = await fetch(url.toString(), {
        method: request.method, signal: controller.signal, redirect: 'error', credentials: 'omit',
        headers: {
          Accept: 'application/json',
          ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(request.key ? { 'Idempotency-Key': request.key } : {}),
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new ApiError('INVALID_RESPONSE', response.status); }
      const envelope = object(payload);
      if (!response.ok) {
        const error = envelope.error && typeof envelope.error === 'object' ? object(envelope.error) : {};
        const meta = envelope.meta && typeof envelope.meta === 'object' ? object(envelope.meta) : {};
        const code = typeof error.code === 'string' && /^[A-Z_]{1,80}$/.test(error.code)
          ? error.code : response.status === 401 ? 'UNAUTHENTICATED' : 'INVALID_RESPONSE';
        const requestId = typeof meta.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(meta.requestId) ? meta.requestId : undefined;
        throw new ApiError(code, response.status, requestId);
      }
      const meta = object(envelope.meta);
      if (typeof meta.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(meta.requestId)) throw new ApiError('INVALID_RESPONSE', response.status);
      if (!('data' in envelope)) throw new ApiError('INVALID_RESPONSE', response.status);
      return { data: envelope.data, replayed: response.headers.get('Idempotent-Replay') === 'true' || response.headers.get('Idempotency-Replayed') === 'true' };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (controller.signal.aborted) throw new ApiError(timedOut ? 'TIMEOUT' : 'CANCELLED');
      throw new ApiError('NETWORK_ERROR');
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', cancel);
    }
  }
}
