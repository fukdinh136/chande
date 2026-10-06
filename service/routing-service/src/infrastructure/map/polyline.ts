import type { Location } from '../../domain/models';
import { invalidProvider } from '../../domain/errors';
export function decodePolyline(value: string, minimumPoints: 1 | 2 = 2): Location[] {
  let index = 0; let lat = 0; let lng = 0; const result: Location[] = [];
  const next = () => {
    let bits = 0; let shift = 0; let byte: number;
    do {
      if (index >= value.length || shift > 30) throw invalidProvider();
      byte = value.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw invalidProvider();
      bits += (byte & 31) * 2 ** shift; shift += 5;
    } while (byte >= 32);
    return bits % 2 ? -(Math.floor(bits / 2) + 1) : bits / 2;
  };
  while (index < value.length) {
    lat += next(); lng += next(); const point = { lat: lat / 1e6, lng: lng / 1e6 };
    if (Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) throw invalidProvider();
    result.push(point);
  }
  if (result.length < minimumPoints) throw invalidProvider(); return result;
}
export function encodePolyline(points: Location[]): string {
  let lat = 0; let lng = 0; let result = '';
  const encode = (n: number) => {
    let value = n < 0 ? -n * 2 - 1 : n * 2;
    while (value >= 32) { result += String.fromCharCode((value % 32) + 95); value = Math.floor(value / 32); }
    result += String.fromCharCode(value + 63);
  };
  for (const p of points) { const a = Math.round(p.lat * 1e6); const b = Math.round(p.lng * 1e6); encode(a - lat); encode(b - lng); lat = a; lng = b; }
  return result;
}
