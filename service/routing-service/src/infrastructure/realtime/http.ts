import { z } from 'zod';
import type { Context, RealtimeLocationPort } from '../../application/ports/clients';
import type { Location } from '../../domain/models';
import { RoutingError } from '../../domain/errors';
const response = z.object({ data: z.object({ radiusMeters: z.literal(2000), drivers: z.array(z.object({ driverId: z.uuid(), vehicleType: z.string(), latitude: z.number().min(-85.0511).max(85.0511), longitude: z.number().min(-180).max(180), distanceMeters: z.number().nonnegative().max(2000), recordedAt: z.iso.datetime() })).max(50) }) });
export class HttpRealtimeLocations implements RealtimeLocationPort {
  constructor(private readonly settings: { baseUrl: string; token: string; maxResponse: number }) {}
  async findNearbyDriverLocations(center: Location, context: Context, vehicleType?: string) {
    const url = new URL(this.settings.baseUrl + '/internal/realtime/nearby-drivers');
    url.search = new URLSearchParams({ latitude: String(center.lat), longitude: String(center.lng), radiusMeters: '2000', ...(vehicleType ? { vehicleType } : {}) }).toString();
    const r = await fetch(url, { signal: context.signal, redirect: 'error', headers: { 'X-Service-Token': this.settings.token, 'X-Request-Id': context.requestId } });
    if (!r.ok || !r.body) { await r.body?.cancel(); throw new RoutingError('REALTIME_UNAVAILABLE', 503); }
    const chunks: Uint8Array[] = []; let bytes = 0;
    for await (const chunk of r.body) { bytes += chunk.length; if (bytes > this.settings.maxResponse) throw new RoutingError('INVALID_REALTIME_RESPONSE', 503); chunks.push(chunk); }
    const parsed = response.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!parsed.success) throw new RoutingError('INVALID_REALTIME_RESPONSE', 503);
    const now = Date.now(); const drivers = parsed.data.data.drivers;
    if (new Set(drivers.map(d => d.driverId)).size !== drivers.length || drivers.some(d => d.vehicleType !== vehicleType || now - Date.parse(d.recordedAt) > 30000 || Date.parse(d.recordedAt) > now + 5000)) throw new RoutingError('INVALID_REALTIME_RESPONSE', 503);
    return drivers.map(d => ({ driverId: d.driverId.toLowerCase(), location: { lat: d.latitude, lng: d.longitude }, observedAt: d.recordedAt }));
  }
}
