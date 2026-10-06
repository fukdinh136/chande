import { fetch } from 'expo/fetch';
import type { RiderConfig } from './config';
import { RiderError } from './errors';

export interface ApiRequest {
  /** Đường dẫn sau prefix gateway, ví dụ "/auth/login". */
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | undefined>;
  idempotencyKey?: string;
  signal?: AbortSignal;
}
export interface ApiResponse { status: number; body: unknown; replayed: boolean }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fallbackCode(status: number): string {
  if (status === 400) return 'INVALID_REQUEST';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN_ACTION';
  if (status === 404) return 'RESOURCE_NOT_FOUND';
  if (status === 409) return 'DATA_CONFLICT';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 504) return 'GATEWAY_TIMEOUT';
  return status >= 500 ? 'DEPENDENCY_UNAVAILABLE' : 'INVALID_RESPONSE';
}

// User Service trả {code, message, fieldErrors}; gateway và các service khác trả {error: {code, message, details}, meta}.
function toError(status: number, body: unknown, requestId: string | null): RiderError {
  const data = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const source = data.error && typeof data.error === 'object' ? data.error as Record<string, unknown> : data;
  const code = typeof source.code === 'string' && /^[A-Z_]{1,80}$/.test(source.code) ? source.code : fallbackCode(status);
  const message = typeof source.message === 'string' && source.message !== code ? source.message : undefined;
  let fieldErrors: Record<string, string> | undefined;
  if (source.fieldErrors && typeof source.fieldErrors === 'object' && !Array.isArray(source.fieldErrors)) {
    fieldErrors = {};
    for (const [field, value] of Object.entries(source.fieldErrors)) if (typeof value === 'string') fieldErrors[field] = value;
  }
  return new RiderError(code, status, message, fieldErrors, requestId && UUID.test(requestId) ? requestId : undefined);
}

export class RiderHttp {
  constructor(private readonly config: RiderConfig) {}

  async send(request: ApiRequest, accessToken?: string | null): Promise<ApiResponse> {
    if (!/^\/[A-Za-z0-9/_.-]*$/.test(request.path) || request.path.includes('//')) throw new RiderError('INVALID_REQUEST');
    const url = new URL(`${this.config.apiBase}${request.path}`);
    for (const [key, value] of Object.entries(request.query ?? {})) if (value !== undefined) url.searchParams.set(key, value);
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    request.signal?.addEventListener('abort', cancel, { once: true });
    if (request.signal?.aborted) cancel();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.config.timeoutMs);
    try {
      const response = await fetch(url.toString(), {
        method: request.method,
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        headers: {
          Accept: 'application/json',
          ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(request.idempotencyKey ? { 'Idempotency-Key': request.idempotencyKey } : {}),
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });
      const text = await response.text();
      let body: unknown = null;
      if (text) {
        try { body = JSON.parse(text); } catch { throw new RiderError(response.ok ? 'INVALID_RESPONSE' : fallbackCode(response.status), response.status); }
      }
      if (!response.ok) throw toError(response.status, body, response.headers.get('X-Request-Id'));
      const replayed = response.headers.get('Idempotency-Replayed') === 'true' || response.headers.get('Idempotent-Replay') === 'true';
      return { status: response.status, body, replayed };
    } catch (error) {
      if (error instanceof RiderError) throw error;
      if (controller.signal.aborted) throw new RiderError(timedOut ? 'TIMEOUT' : 'CANCELLED');
      throw new RiderError('NETWORK_ERROR');
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', cancel);
    }
  }
}

/** Lấy `data` trong envelope {data, meta} của Trip/Routing. */
export function envelopeData(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('data' in body)) throw new RiderError('INVALID_RESPONSE');
  return (body as { data: unknown }).data;
}
