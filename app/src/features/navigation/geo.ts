// Hình học cho quãng đường ngắn trong đô thị. Toạ độ theo thứ tự GeoJSON [lng, lat].
export type LngLat = [number, number];
export interface LatLng { lat: number; lng: number }
export type Bounds = [west: number, south: number, east: number, north: number];

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const toLngLat = (point: LatLng): LngLat => [point.lng, point.lat];
export const toLatLng = ([lng, lat]: LngLat): LatLng => ({ lat, lng });

export function isValidLatLng(point: LatLng | null | undefined): point is LatLng {
  return !!point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && point.lat >= -90 && point.lat <= 90 && point.lng >= -180 && point.lng <= 180;
}

export function distance(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearing(a: LngLat, b: LngLat): number {
  const lat1 = toRad(a[1]), lat2 = toRad(b[1]), dLng = toRad(b[0] - a[0]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function cumulativeDistances(points: LngLat[]): number[] {
  const result = [0];
  for (let i = 1; i < points.length; i++) result.push(result[i - 1] + distance(points[i - 1], points[i]));
  return result;
}

export function lineLength(points: LngLat[]): number {
  const cumulative = cumulativeDistances(points);
  return cumulative[cumulative.length - 1];
}

export interface LinePosition {
  /** Chỉ số điểm đầu của đoạn gần nhất. */
  segment: number;
  point: LngLat;
  /** Khoảng cách (m) từ điểm cần tìm đến tuyến. */
  offset: number;
  /** Quãng đường (m) từ đầu tuyến đến điểm chiếu. */
  along: number;
}
export interface NearestOptions {
  cumulative?: number[];
  fromSegment?: number;
  /** Ưu tiên vị trí gần quãng đường dự kiến, tránh bắt nhầm khi tuyến đi qua cùng một chỗ hai lần. */
  expectedAlong?: number;
  alongWeight?: number;
}

// Chiếu xấp xỉ equirectangular quanh điểm cần tìm: sai số không đáng kể ở cự ly vài km.
function projectOnSegment(a: LngLat, b: LngLat, target: LngLat) {
  const k = Math.cos(toRad(target[1]));
  const ax = a[0] * k, bx = b[0] * k, px = target[0] * k;
  const dx = bx - ax, dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : clamp(((px - ax) * dx + (target[1] - a[1]) * dy) / length2, 0, 1);
  const point: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { t, point };
}

export function nearestOnLine(points: LngLat[], target: LngLat, options: NearestOptions = {}): LinePosition {
  if (points.length === 0) return { segment: 0, point: target, offset: 0, along: 0 };
  if (points.length === 1) return { segment: 0, point: points[0], offset: distance(points[0], target), along: 0 };
  const cumulative = options.cumulative ?? cumulativeDistances(points);
  const weight = options.expectedAlong === undefined ? 0 : options.alongWeight ?? 0.05;
  let best: LinePosition | null = null;
  let bestScore = Infinity;
  for (let i = clamp(options.fromSegment ?? 0, 0, points.length - 2); i < points.length - 1; i++) {
    const { t, point } = projectOnSegment(points[i], points[i + 1], target);
    const offset = distance(point, target);
    const along = cumulative[i] + (cumulative[i + 1] - cumulative[i]) * t;
    const score = offset + (weight ? Math.abs(along - (options.expectedAlong ?? 0)) * weight : 0);
    if (score < bestScore) {
      bestScore = score;
      best = { segment: i, point, offset, along };
    }
  }
  return best ?? { segment: 0, point: points[0], offset: distance(points[0], target), along: 0 };
}

export function pointAlong(points: LngLat[], cumulative: number[], along: number): LngLat {
  if (points.length === 1) return points[0];
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] <= along) lo = mid; else hi = mid;
  }
  const span = cumulative[hi] - cumulative[lo];
  const t = span === 0 ? 0 : clamp((along - cumulative[lo]) / span, 0, 1);
  return [points[lo][0] + (points[hi][0] - points[lo][0]) * t, points[lo][1] + (points[hi][1] - points[lo][1]) * t];
}

/** Cắt đoạn tuyến trong khoảng [start, end] tính theo quãng đường; luôn trả về ít nhất hai điểm. */
export function sliceAlong(points: LngLat[], cumulative: number[], start: number, end: number): LngLat[] {
  const total = cumulative[cumulative.length - 1];
  const from = clamp(start, 0, total);
  const to = clamp(end, from, total);
  const result: LngLat[] = [pointAlong(points, cumulative, from)];
  for (let i = 0; i < points.length; i++) {
    if (cumulative[i] > from && cumulative[i] < to) result.push(points[i]);
  }
  result.push(pointAlong(points, cumulative, to));
  return result;
}

export function boundsOf(points: LngLat[]): Bounds | null {
  if (points.length === 0) return null;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [lng, lat] of points) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  return [west, south, east, north];
}

const CARDINALS = ['bắc', 'đông bắc', 'đông', 'đông nam', 'nam', 'tây nam', 'tây', 'tây bắc'];
export function cardinal(degrees: number): string {
  const normalized = ((degrees % 360) + 360) % 360;
  return CARDINALS[Math.round(normalized / 45) % 8];
}
