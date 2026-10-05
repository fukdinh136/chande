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
      const parsed = z.object({ data: schema, meta: z.object({ requestId: z.uuid() }) }).safeParse(await response.json());
      if (!parsed.success) throw new TransportError(false, 'INVALID_RESPONSE');
      return parsed.data.data;
    } catch (error) {
      if (error instanceof TransportError) throw error;
      throw new TransportError(!(error instanceof SyntaxError), error instanceof SyntaxError ? 'INVALID_RESPONSE' : 'NETWORK_ERROR');
    }
  }
}
