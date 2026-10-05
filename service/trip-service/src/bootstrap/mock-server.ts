import { createServer, type IncomingMessage } from 'node:http';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assignmentBody, estimateBody, parse, uuid } from '../api/schemas';
import type { Assignment } from '../domain/models';
import { requestHash } from '../application/use-cases/shared';
import { verifyServiceCredential } from '../api/auth';
import { DomainError } from '../domain/error';
interface MockState { receipts: Record<string, { hash: string; result: unknown }>; trips: Record<string, { status: 'searching' | 'assigned' | 'cancelled' | 'completed'; assignment?: Assignment }> }
export interface MockOptions { file: string; apiUrl: string; callbackToken: string; issuer: string; audience: string; tokens: { routing: string; pricing: string; matching: string; gateway: string; notification: string } }
export async function createMockServer(options: MockOptions) {
  if (process.env.NODE_ENV === 'production') throw new Error('Development mocks are disabled in production');
  const jose = await import('jose'); const keys = await jose.generateKeyPair('RS256'); const jwk = await jose.exportJWK(keys.publicKey);
  let state: MockState = existsSync(options.file) ? JSON.parse(readFileSync(options.file, 'utf8')) as MockState : { receipts: {}, trips: {} };
  const persist = () => { mkdirSync(dirname(options.file), { recursive: true }); writeFileSync(options.file + '.tmp', JSON.stringify(state), { mode: 0o600 }); renameSync(options.file + '.tmp', options.file); };
  const receive = (scope: string, id: string, input: unknown, result: unknown, effect: () => void = () => {}) => {
    const key = `${scope}:${id}`; const hash = requestHash(input); const prior = state.receipts[key];
    if (prior) { if (prior.hash !== hash) throw new DomainError('EVENT_ID_REUSED'); return prior.result; }
    const previous = structuredClone(state);
    try { effect(); state.receipts[key] = { hash, result }; persist(); } catch (error) { state = previous; throw error; }
    return result;
  };
  async function body(req: IncomingMessage): Promise<unknown> { const chunks: Buffer[] = []; let size = 0; for await (const part of req) { const chunk = Buffer.from(part as Uint8Array); size += chunk.length; if (size > 65536) throw new DomainError('INVALID_REQUEST'); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new DomainError('INVALID_REQUEST'); } }
  return createServer((req, res) => { void (async () => {
    const requestId = z.uuid().safeParse(req.headers['x-request-id']).success ? String(req.headers['x-request-id']) : randomUUID();
    const reply = (status: number, data: unknown) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ data, meta: { requestId } })); };
    try {
      if (req.url === '/health/live' && req.method === 'GET') { reply(200, { status: 'ok' }); return; }
      if (req.url === '/jwks' && req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ keys: [{ ...jwk, kid: 'local', alg: 'RS256', use: 'sig' }] })); return; }
      if (req.method !== 'POST') { reply(404, {}); return; }
      const input = await body(req); const token = typeof req.headers['x-service-token'] === 'string' ? req.headers['x-service-token'] : undefined;
      if (req.url === '/mock/token') {
        const principal = parse(z.object({ sub: uuid, role: z.enum(['RIDER', 'DRIVER']) }).strict(), input);
        const accessToken = await new jose.SignJWT({ role: principal.role }).setProtectedHeader({ alg: 'RS256', kid: 'local' }).setSubject(principal.sub).setIssuer(options.issuer).setAudience(options.audience).setExpirationTime('1h').sign(keys.privateKey);
        reply(200, { accessToken, tokenType: 'Bearer', expiresIn: 3600 }); return;
      }
      if (req.url === '/internal/routes/estimate') { verifyServiceCredential(token, options.tokens.routing); parse(estimateBody, input); reply(200, { distanceMeters: 4000, durationSeconds: 600 }); return; }
      if (req.url === '/internal/fares/estimate') { verifyServiceCredential(token, options.tokens.pricing); parse(z.object({ route: z.object({ distanceMeters: z.number().int().nonnegative(), durationSeconds: z.number().int().nonnegative() }).strict(), vehicleType: z.string() }).strict(), input); reply(200, { currency: 'VND', amount: '45000', breakdown: [{ code: 'MOCK_FLAT', amount: '45000' }] }); return; }
      if (req.url === '/internal/matching/requests' || /^\/internal\/matching\/requests\/[\w-]+\/cancel$/.test(req.url ?? '')) {
        verifyServiceCredential(token, options.tokens.matching);
        const data = parse(z.object({ commandId: uuid, tripId: uuid, tripVersion: z.number().int().positive(), type: z.enum(['matching.search.requested', 'matching.search.cancelled']), occurredAt: z.iso.datetime() }).passthrough(), input);
        const cancel = req.url !== '/internal/matching/requests'; if (data.type !== (cancel ? 'matching.search.cancelled' : 'matching.search.requested') || (cancel && req.url?.split('/')[4] !== data.tripId)) throw new DomainError('INVALID_REQUEST');
        const ack = receive('matching', data.commandId, input, { commandId: data.commandId, accepted: true }, () => { if (cancel) state.trips[data.tripId] = { status: 'cancelled' }; else state.trips[data.tripId] ??= { status: 'searching' }; });
        reply(202, ack); return;
      }
      if (req.url === '/internal/events/trips') {
        const destination = (['matching', 'gateway', 'notification'] as const).find(key => options.tokens[key] === token); if (!destination) throw new DomainError('INVALID_SERVICE_CREDENTIAL');
        const data = parse(z.object({ eventId: uuid, tripId: uuid, tripVersion: z.number().int().positive(), type: z.string(), schemaVersion: z.literal(1), occurredAt: z.iso.datetime(), data: z.object({ riderId: uuid, driverId: uuid.nullable(), status: z.string() }) }).strict(), input);
        const ack = receive(destination, data.eventId, input, { eventId: data.eventId, accepted: true }, () => { if (destination === 'matching' && data.type === 'trip.completed') state.trips[data.tripId] = { status: 'completed' }; });
        reply(202, ack); return;
      }
      if (req.url === '/mock/accept') {
        const data = parse(assignmentBody.extend({ tripId: uuid }), input); const { tripId, ...assignment } = data; const trip = state.trips[tripId];
        if (!trip || !['searching', 'assigned'].includes(trip.status)) throw new DomainError('TRIP_NOT_SEARCHING');
        if (trip.assignment && requestHash(trip.assignment) !== requestHash(assignment)) throw new DomainError('TRIP_ALREADY_ASSIGNED');
        if (Object.entries(state.trips).some(([id, other]) => id !== tripId && !['cancelled', 'completed'].includes(other.status) && other.assignment?.driverId === assignment.driverId)) throw new DomainError('DRIVER_HAS_ACTIVE_TRIP');
        trip.assignment = assignment; persist();
        const response = await fetch(`${options.apiUrl}/internal/trips/${tripId}/assignment`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': options.callbackToken, 'x-request-id': requestId }, body: JSON.stringify(assignment), signal: AbortSignal.timeout(5000), redirect: 'error' });
        const ack = await response.json() as { data?: unknown; error?: { code: string } };
        if (response.status === 202) { if (state.trips[tripId] === trip && trip.status === 'searching') { trip.status = 'assigned'; persist(); } reply(202, ack.data); }
        else { if (response.status === 409 && state.trips[tripId] === trip) { delete trip.assignment; if (['TRIP_NOT_SEARCHING', 'TRIP_ALREADY_ASSIGNED'].includes(ack.error?.code ?? '')) trip.status = 'cancelled'; persist(); } throw new DomainError(ack.error?.code ?? 'DEPENDENCY_UNAVAILABLE'); }
        return;
      }
      reply(404, {});
    } catch (error) { const code = error instanceof DomainError ? error.code : 'DEPENDENCY_UNAVAILABLE'; const status = code === 'INVALID_SERVICE_CREDENTIAL' ? 401 : code === 'INVALID_REQUEST' ? 400 : code === 'DEPENDENCY_UNAVAILABLE' ? 503 : 409; res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code, message: code, details: [] }, meta: { requestId } })); }
  })().catch(() => { res.destroy(); }); });
}
