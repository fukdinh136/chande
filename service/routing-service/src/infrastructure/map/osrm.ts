import { z } from 'zod';
import type { Config } from '../../bootstrap/config';
import type { Clock, Context, MapProvider } from '../../application/ports/clients';
import { checkpoint } from '../../application/context';
import { RoutingError, deadline, invalidProvider } from '../../domain/errors';
import { locationSchema, measurement, type RouteRequest, type MatrixRequest, type Route, type Cell, type Location } from '../../domain/models';
import { decodePolyline } from './polyline';
import { navigationRouteSchema } from '../../domain/navigation';
const amount = z.number().nonnegative().max(2147483647);
const stepSchema = z.object({ distance: amount, duration: amount, name: z.string(), maneuver: z.object({ type: z.string().min(1), modifier: z.string().optional(), location: z.tuple([z.number(), z.number()]), exit: z.number().int().positive().optional() }) });
const routeSchema = z.object({ distance: amount, duration: amount, geometry: z.string().optional(), legs: z.array(z.object({ steps: z.array(stepSchema) })).optional() });
const matrixSchema = z.object({ durations: z.array(z.array(amount.nullable())), distances: z.array(z.array(amount.nullable())) });
export class OsrmProvider implements MapProvider {
  constructor(private readonly config: Config, private readonly clock: Clock, private readonly fetcher: typeof fetch = fetch) {}
  private coords(points: Location[]): string { return points.map(p => `${p.lng},${p.lat}`).join(';'); }
  private async request(vehicle: string, path: string, query: Record<string, string>, context: Context): Promise<unknown> {
    checkpoint(context, this.clock);
    const profile = this.config.profiles[vehicle]; if (!profile) throw new RoutingError('UNSUPPORTED_VEHICLE_TYPE', 400);
    const url = new URL(`/${path}/v1/${profile.profile}/${query.coordinates}`, profile.baseUrl);
    for (const [k, v] of Object.entries(query)) if (k !== 'coordinates') url.searchParams.set(k, v);
    const controller = new AbortController(); const abort = () => controller.abort();
    context.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, Math.max(1, Math.min(this.config.limits.upstreamTimeout, context.deadline - this.clock.now())));
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const headers: Record<string, string> = { 'X-Request-Id': context.requestId };
      if (this.config.map.auth === 'header') headers[this.config.map.keyHeader] = this.config.map.key;
      const response = await this.fetcher(url, { headers, signal: controller.signal, redirect: 'error' });
      if (response.status === 401 || response.status === 403) throw new RoutingError('PROVIDER_CONFIGURATION_ERROR', 503);
      if (response.status === 429 || response.status >= 500) throw new RoutingError('PROVIDER_UNAVAILABLE', 503, true);
      if (response.status !== 200 && response.status !== 400) throw new RoutingError('PROVIDER_CONFIGURATION_ERROR', 503);
      const length = response.headers.get('content-length');
      if (length && Number(length) > this.config.limits.maxResponse) throw invalidProvider();
      if (!response.body) throw invalidProvider(); reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength; if (size > this.config.limits.maxResponse) throw invalidProvider(); chunks.push(part.value);
      }
      let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw invalidProvider(); }
      const code = z.object({ code: z.string() }).safeParse(body); if (!code.success) throw invalidProvider();
      if (['NoRoute', 'NoSegment', 'NoTable'].includes(code.data.code)) throw new RoutingError('NO_ROUTE', 422);
      if (code.data.code === 'NotImplemented') throw new RoutingError('UNSUPPORTED_CAPABILITY', 422);
      if (code.data.code === 'TooBig' || code.data.code.startsWith('Invalid')) throw new RoutingError('PROVIDER_CONFIGURATION_ERROR', 503);
      if (code.data.code !== 'Ok' || response.status !== 200) throw invalidProvider();
      checkpoint(context, this.clock); return body;
    } catch (error) {
      if (context.signal.aborted || this.clock.now() >= context.deadline) throw deadline();
      if (error instanceof RoutingError) throw error;
      throw new RoutingError('PROVIDER_UNAVAILABLE', 503, true);
    } finally {
      controller.abort(); await reader?.cancel().catch(() => undefined); reader?.releaseLock();
      clearTimeout(timer); context.signal.removeEventListener('abort', abort);
    }
  }
  async route(input: RouteRequest, context: Context): Promise<Route> {
    const query: Record<string, string> = { coordinates: this.coords([input.origin, input.destination]), alternatives: 'false', overview: input.full ? 'full' : 'false', steps: String(input.full && input.includeSteps) };
    if (input.full) query.geometries = 'polyline6';
    const raw = await this.request(input.vehicleType, 'route', query, context);
    const parsed = z.object({ routes: z.array(routeSchema).min(1) }).safeParse(raw); if (!parsed.success) throw invalidProvider();
    const source = parsed.data.routes[0]!; const result: Route = { distanceMeters: measurement(source.distance), durationSeconds: measurement(source.duration), steps: [] };
    if (input.navigation) {
      const rich = z.object({ routes: z.array(navigationRouteSchema).min(1) }).safeParse(raw);
      if (!rich.success) throw invalidProvider();
      result.navigation = rich.data.routes[0]!;
      decodePolyline(result.navigation.geometry);
      for (const leg of result.navigation.legs) for (const step of leg.steps) decodePolyline(step.geometry);
    }
    if (input.full) {
      if (!source.geometry) throw invalidProvider(); decodePolyline(source.geometry);
      result.polyline = { encoding: 'encoded_polyline', precision: 6, value: source.geometry };
      if (input.includeSteps) {
        if (!source.legs?.length) throw invalidProvider();
        result.steps = source.legs.flatMap(leg => leg.steps.map(step => {
          const point = locationSchema.safeParse({ lng: step.maneuver.location[0], lat: step.maneuver.location[1] }); if (!point.success) throw invalidProvider();
          return { distanceMeters: measurement(step.distance), durationSeconds: measurement(step.duration), streetName: step.name || null, instruction: null,
            maneuver: { type: step.maneuver.type, modifier: step.maneuver.modifier ?? null, location: point.data, exit: step.maneuver.exit ?? null } };
        }));
      }
    }
    return result;
  }
  async matrix(input: MatrixRequest, context: Context): Promise<Cell[]> {
    const n = input.origins.length; if (!n) return [];
    const raw = await this.request(input.vehicleType, 'table', { coordinates: this.coords([...input.origins, input.destination]), sources: input.origins.map((_, i) => String(i)).join(';'), destinations: String(n), annotations: 'duration,distance' }, context);
    const parsed = matrixSchema.safeParse(raw); if (!parsed.success) throw invalidProvider();
    const { durations, distances } = parsed.data;
    if (durations.length !== n || distances.length !== n) throw invalidProvider();
    return input.origins.map((_, i) => {
      const d = distances[i]!; const t = durations[i]!; if (d.length !== 1 || t.length !== 1) throw invalidProvider();
      if (d[0] === null && t[0] === null) return { status: 'NO_ROUTE', distanceMeters: null, durationSeconds: null };
      if (d[0] === null || t[0] === null) throw invalidProvider();
      return { status: 'OK', distanceMeters: measurement(d[0]), durationSeconds: measurement(t[0]) };
    });
  }
}
