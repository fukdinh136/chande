import { fetch } from 'expo/fetch';
import type { LatLng } from '../navigation/geo';
import { RiderError } from './errors';

// Tìm địa điểm qua Photon (dữ liệu OpenStreetMap). Hệ thống chưa có dịch vụ geocoding riêng (Trip/Routing chỉ nhận toạ độ),
// nên đây là tuỳ chọn bật bằng EXPO_PUBLIC_GEOCODER_URL; nội dung tìm kiếm được gửi tới máy chủ đó.
export interface GeoPlace { id: string; title: string; subtitle: string; lat: number; lng: number }

const VIETNAM_BBOX = '102.1,8.2,109.5,23.4';

function parse(payload: unknown): GeoPlace[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { features?: unknown }).features)) return [];
  const result: GeoPlace[] = [];
  for (const feature of (payload as { features: unknown[] }).features) {
    if (!feature || typeof feature !== 'object') continue;
    const { geometry, properties } = feature as { geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> };
    const coordinates: unknown[] = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
    const [lng, lat] = coordinates;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !properties) continue;
    const text = (key: string) => (typeof properties[key] === 'string' ? properties[key] as string : '');
    const street = [text('housenumber'), text('street')].filter(Boolean).join(' ');
    const title = text('name') || street;
    if (!title) continue;
    const subtitle = [text('name') ? street : '', text('district'), text('city') || text('county'), text('state')]
      .filter((part, index, parts) => part && parts.indexOf(part) === index).join(', ');
    result.push({ id: `${text('osm_type')}${String(properties.osm_id ?? `${lat},${lng}`)}`, title, subtitle, lat, lng });
  }
  return result;
}

export class Geocoder {
  constructor(private readonly baseUrl: string, private readonly timeoutMs: number) {}

  private async get(path: string, query: Record<string, string>, signal?: AbortSignal): Promise<GeoPlace[]> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, this.timeoutMs);
    try {
      const response = await fetch(url.toString(), { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new RiderError('GEOCODER_UNAVAILABLE', response.status);
      return parse(await response.json());
    } catch (error) {
      if (signal?.aborted) throw new RiderError('CANCELLED');
      throw error instanceof RiderError ? error : new RiderError('GEOCODER_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }

  search(text: string, near: LatLng | null, signal?: AbortSignal) {
    return this.get('/api/', {
      q: text, limit: '8', lang: 'default', bbox: VIETNAM_BBOX,
      ...(near ? { lat: near.lat.toFixed(5), lon: near.lng.toFixed(5) } : {}),
    }, signal);
  }

  async reverse(point: LatLng, signal?: AbortSignal): Promise<GeoPlace | null> {
    const places = await this.get('/reverse', { lat: point.lat.toFixed(6), lon: point.lng.toFixed(6), limit: '1', lang: 'default' }, signal);
    return places[0] ?? null;
  }
}
