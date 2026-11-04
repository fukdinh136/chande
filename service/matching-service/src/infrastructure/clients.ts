import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Clients } from '../application/ports';
import type { Config } from '../bootstrap/config';
import { uuid, type Assignment, type Command } from '../domain/models';
/** A failed call to another service: HTTP status (0 when there was no response), its error code, and its Retry-After. */
export class UpstreamError extends Error {
  constructor(readonly status: number, readonly code = 'HTTP_' + status, readonly dependency = 'unknown', readonly retryAfterMs: number | null = null) { super('UPSTREAM_ERROR'); }
}
// Reads the error code ({error:{code}}) from at most 16 KiB of an error body, and Retry-After in seconds.
async function failure(r: Response, dependency: string): Promise<UpstreamError> {
  let code = 'HTTP_' + r.status;
  try {
    const chunks: Uint8Array[] = []; let bytes = 0;
    if (r.body) for await (const chunk of r.body) { chunks.push(chunk); bytes += chunk.length; if (bytes > 16384) break; }
    const value = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { error?: { code?: unknown } } | null)?.error?.code;
    if (typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value)) code = value;
  } catch { await r.body?.cancel().catch(() => {}); }
  const after = Number(r.headers.get('retry-after'));
  return new UpstreamError(r.status, code, dependency, Number.isFinite(after) && after > 0 ? Math.min(after, 60) * 1000 : null);
}
const matrix = z.object({ entries: z.array(z.object({ driverId: uuid, observedAt: z.iso.datetime(), status: z.enum(['OK', 'NO_ROUTE']), distanceMeters: z.number().int().nonnegative().nullable(), durationSeconds: z.number().int().nonnegative().nullable() })).max(50), radiusMeters: z.literal(2000) });
const eligibility = z.object({ driverId: uuid, profileEligible: z.boolean(), desiredStatus: z.string(), vehicleId: uuid.nullable(), driverSnapshot: z.object({ fullName: z.string().min(1).max(100), avatarUrl: z.string().nullable() }).nullable(), vehicleSnapshot: z.object({ vehicleType: z.string(), licensePlate: z.string().min(1).max(15), brand: z.string().nullable(), color: z.string().nullable() }).nullable() });
export class HttpClients implements Clients {
  constructor(private readonly c: Config) {}
  async request<T>(base: string, path: string, token: string, schema: z.ZodType<T>, body?: unknown, expected = 200): Promise<T> {
    const dependency = base === this.c.routingUrl ? 'routing' : base === this.c.driverUrl ? 'driver' : base === this.c.tripUrl ? 'trip' : 'unknown';
    let r: Response;
    try { r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(this.c.httpTimeout), headers: { 'X-Service-Token': token, 'X-Request-Id': randomUUID(), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    catch (error) { throw new UpstreamError(0, error instanceof Error && error.name === 'TimeoutError' ? 'TIMEOUT' : 'UNREACHABLE', dependency); }
    if (r.status !== expected || !r.body) throw await failure(r, dependency);
    const chunks: Uint8Array[] = []; let bytes = 0; for await (const chunk of r.body) { bytes += chunk.length; if (bytes > 1048576) throw new UpstreamError(503, 'RESPONSE_TOO_LARGE', dependency); chunks.push(chunk); }
    const result = z.object({ data: schema }).safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8'))); if (!result.success) throw new UpstreamError(503, 'INVALID_RESPONSE', dependency); return result.data.data;
  }
  async matrix(command: Command) { return (await this.request(this.c.routingUrl, '/routes/matrix', this.c.routingToken, matrix, { pickup: command.pickup, vehicleType: command.vehicleType })).entries; }
  async driver(id: string, type: string) { const data = await this.request(this.c.driverUrl, `/internal/drivers/${id}/eligibility?vehicleType=${encodeURIComponent(type)}`, this.c.driverToken, eligibility); if (data.driverId !== id) throw new UpstreamError(503, 'INVALID_RESPONSE', 'driver'); return data; }
  async assign(tripId: string, assignment: Assignment) {
    const ack = await this.request(this.c.tripUrl, `/internal/trips/${tripId}/assignment`, this.c.tripToken, z.object({ eventId: uuid, tripId: uuid, accepted: z.literal(true), assignedVersion: z.number().int().positive() }).strict(), assignment, 202);
    if (ack.eventId !== assignment.eventId || ack.tripId !== tripId) throw new UpstreamError(503, 'INVALID_RESPONSE', 'trip');
  }
  async trip(id: string) { const data = await this.request(this.c.tripUrl, `/internal/trips/${id}/matching-state`, this.c.tripToken, z.object({ tripId: uuid, status: z.enum(['CREATED','SEARCHING','ASSIGNED','DRIVER_ARRIVED','IN_PROGRESS','CANCELLED','COMPLETED']), driverId: uuid.nullable(), version: z.number().int().positive() })); if (data.tripId !== id) throw new UpstreamError(503); return data; }
}
