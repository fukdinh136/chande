import type { LngLat } from './geo';

// Encoded Polyline của Google. OSRM, routing-service và Navigation SDK đều dùng độ chính xác 6.
export function decodePolyline(encoded: string, precision = 6): LngLat[] {
  const factor = 10 ** precision;
  const points: LngLat[] = [];
  let index = 0, lat = 0, lng = 0;
  const next = () => {
    let result = 0, shift = 0, byte: number;
    do {
      if (index >= encoded.length || shift > 30) throw new Error('INVALID_POLYLINE');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error('INVALID_POLYLINE');
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    points.push([lng / factor, lat / factor]);
  }
  return points;
}

// Làm tròn nửa xa số 0 như các bản cài đặt tham chiếu, để mã hoá lại cho ra cùng chuỗi.
const roundHalfAway = (value: number) => Math.sign(value) * Math.floor(Math.abs(value) + 0.5);

export function encodePolyline(points: LngLat[], precision = 6): string {
  const factor = 10 ** precision;
  let output = '', previousLat = 0, previousLng = 0;
  const push = (delta: number) => {
    let value = delta < 0 ? ~(delta << 1) : delta << 1;
    while (value >= 0x20) {
      output += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
      value >>>= 5;
    }
    output += String.fromCharCode(value + 63);
  };
  for (const [lng, lat] of points) {
    const latE = roundHalfAway(lat * factor);
    const lngE = roundHalfAway(lng * factor);
    push(latE - previousLat);
    push(lngE - previousLng);
    previousLat = latE;
    previousLng = lngE;
  }
  return output;
}
