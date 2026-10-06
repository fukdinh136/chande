import type { LatLng } from '../navigation/geo';

// Style mặc định: OpenFreeMap (dữ liệu OpenStreetMap, miễn phí, không cần khoá). Attribution do bản đồ tự hiện.
const DEFAULT_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
// Hồ Hoàn Kiếm: trung tâm vùng phục vụ (dữ liệu OSRM của hệ thống chỉ có Hà Nội).
const DEFAULT_CENTER: LatLng = { lat: 21.0285, lng: 105.8542 };

function styleUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_STYLE_URL;
  try {
    const url = new URL(trimmed);
    return ['http:', 'https:'].includes(url.protocol) ? trimmed : DEFAULT_STYLE_URL;
  } catch { return DEFAULT_STYLE_URL; }
}

function center(value: string | undefined): LatLng {
  const [lng, lat] = (value ?? '').split(',').map((part) => Number(part.trim()));
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : DEFAULT_CENTER;
}

// Expo chỉ thay EXPO_PUBLIC_* khi được đọc trực tiếp theo tên.
export const MAP_STYLE_URL = styleUrl(process.env.EXPO_PUBLIC_MAP_STYLE_URL);
/** Dạng "lng,lat". */
export const MAP_DEFAULT_CENTER = center(process.env.EXPO_PUBLIC_MAP_CENTER);
