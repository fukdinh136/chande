import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Clients } from '../application/ports';
import type { Config } from '../bootstrap/config';
import { uuid, type Assignment, type Command } from '../domain/models';
export class UpstreamError extends Error { constructor(readonly status: number) { super('UPSTREAM_ERROR'); } }
const matrix = z.object({ entries: z.array(z.object({ driverId: uuid, observedAt: z.iso.datetime(), status: z.enum(['OK', 'NO_ROUTE']), distanceMeters: z.number().int().nonnegative().nullable(), durationSeconds: z.number().int().nonnegative().nullable() })).max(50), radiusMeters: z.literal(2000) });
const eligibility = z.object({ driverId: uuid, profileEligible: z.boolean(), desiredStatus: z.string(), vehicleId: uuid.nullable(), driverSnapshot: z.object({ fullName: z.string().min(1).max(100), avatarUrl: z.string().nullable() }).nullable(), vehicleSnapshot: z.object({ vehicleType: z.string(), licensePlate: z.string().min(1).max(15), brand: z.string().nullable(), color: z.string().nullable() }).nullable() });
export class HttpClients implements Clients {
  constructor(private readonly c: Config) {}
  async request<T>(base: string, path: string, token: string, schema: z.ZodType<T>, body?: unknown, expected = 200): Promise<T> {
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(this.c.httpTimeout), headers: { 'X-Service-Token': token, 'X-Request-Id': randomUUID(), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (r.status !== expected || !r.body) { await r.body?.cancel(); throw new UpstreamError(r.status); }
    const chunks: Uint8Array[] = []; let bytes = 0; for await (const chunk of r.body) { bytes += chunk.length; if (bytes > 1048576) throw new UpstreamError(503); chunks.push(chunk); }
    const result = z.object({ data: schema }).safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8'))); if (!result.success) throw new UpstreamError(503); return result.data.data;
  }
  async matrix(command: Command) { return (await this.request(this.c.routingUrl, '/routes/matrix', this.c.routingToken, matrix, { pickup: command.pickup, vehicleType: command.vehicleType })).entries; }
  async driver(id: string, type: string) { const data = await this.request(this.c.driverUrl, `/internal/drivers/${id}/eligibility?vehicleType=${encodeURIComponent(type)}`, this.c.driverToken, eligibility); if (data.driverId !== id) throw new UpstreamError(503); return data; }
  async assign(tripId: string, assignment: Assignment) {
    const ack = await this.request(this.c.tripUrl, `/internal/trips/${tripId}/assignment`, this.c.tripToken, z.object({ eventId: uuid, tripId: uuid, accepted: z.literal(true), assignedVersion: z.number().int().positive() }).strict(), assignment, 202);
    if (ack.eventId !== assignment.eventId || ack.tripId !== tripId) throw new UpstreamError(503);
  }
  async trip(id: string) { const data = await this.request(this.c.tripUrl, `/internal/trips/${id}/matching-state`, this.c.tripToken, z.object({ tripId: uuid, status: z.enum(['CREATED','SEARCHING','ASSIGNED','DRIVER_ARRIVED','IN_PROGRESS','CANCELLED','COMPLETED']), driverId: uuid.nullable(), version: z.number().int().positive() })); if (data.tripId !== id) throw new UpstreamError(503); return data; }
}
