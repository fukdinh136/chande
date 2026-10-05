import { z } from 'zod';
export class TransportError extends Error {
  constructor(public readonly retryable: boolean, public readonly reason: string) { super(reason); }
}
export class JsonHttpClient {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly timeout: number) {}
  async post<T>(path: string, body: unknown, requestId: string, schema: z.ZodType<T>, status = 200): Promise<T> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': this.token, 'x-request-id': requestId }, body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeout), redirect: 'error' });
      if (response.status !== status) { await response.body?.cancel(); throw new TransportError(response.status === 429 || response.status >= 500, `HTTP_${response.status}`); }
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json') || !response.body) { await response.body?.cancel(); throw new TransportError(false, 'INVALID_RESPONSE'); }
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      try { for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 1048576) { await reader.cancel(); throw new TransportError(false, 'RESPONSE_TOO_LARGE'); } chunks.push(value); } }
      finally { reader.releaseLock(); }
      const parsed = z.object({ data: schema, meta: z.object({ requestId: z.uuid() }) }).safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (!parsed.success) throw new TransportError(false, 'INVALID_RESPONSE');
      return parsed.data.data;
    } catch (error) {
      if (error instanceof TransportError) throw error;
      throw new TransportError(!(error instanceof SyntaxError), error instanceof SyntaxError ? 'INVALID_RESPONSE' : 'NETWORK_ERROR');
    }
  }
}
