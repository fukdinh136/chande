import { RiderError } from './errors';

export interface RiderConfig {
  /** Gốc API Gateway kèm prefix, ví dụ http://10.0.2.2:8080/api/v1. */
  apiBase: string;
  /** WebSocket trạng thái chuyến của gateway; null nếu tắt. */
  wsUrl: string | null;
  timeoutMs: number;
  pollIntervalMs: number;
  vehicleTypes: string[];
  /** Photon (OpenStreetMap) để tìm địa điểm; null nếu tắt. */
  geocoderUrl: string | null;
}

function origin(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, '');
  if (!trimmed) throw new RiderError('CONFIGURATION_REQUIRED');
  try {
    const url = new URL(trimmed);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    if (!__DEV__ && url.protocol !== 'https:') throw new Error();
    return trimmed;
  } catch { throw new RiderError('CONFIGURATION_REQUIRED'); }
}

function optionalUrl(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return ['http:', 'https:'].includes(url.protocol) ? trimmed : null;
  } catch { return null; }
}

export function loadRiderConfig(): RiderConfig {
  // Expo chỉ thay EXPO_PUBLIC_* khi biến được đọc trực tiếp theo tên.
  const base = origin(process.env.EXPO_PUBLIC_API_BASE_URL);
  const prefix = (process.env.EXPO_PUBLIC_API_PREFIX ?? '/api/v1').trim().replace(/\/+$/, '');
  if (prefix && !/^\/[A-Za-z0-9/_-]+$/.test(prefix)) throw new RiderError('CONFIGURATION_REQUIRED');
  const wsPath = (process.env.EXPO_PUBLIC_API_WS_PATH ?? '/ws').trim();
  const timeoutMs = Number(process.env.EXPO_PUBLIC_HTTP_TIMEOUT_MS ?? 10000);
  const pollIntervalMs = Number(process.env.EXPO_PUBLIC_RIDER_TRIP_POLL_MS ?? 10000);
  const vehicleTypes = (process.env.EXPO_PUBLIC_RIDER_VEHICLE_TYPES ?? 'BIKE,CAR_4,CAR_7')
    .split(',').map((item) => item.trim()).filter((item) => /^[A-Za-z0-9_-]{1,32}$/.test(item));
  return {
    apiBase: `${base}${prefix}`,
    wsUrl: wsPath ? `${base.replace(/^http/, 'ws')}${wsPath.startsWith('/') ? wsPath : `/${wsPath}`}` : null,
    timeoutMs: Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 60000 ? timeoutMs : 10000,
    pollIntervalMs: Number.isInteger(pollIntervalMs) && pollIntervalMs >= 5000 && pollIntervalMs <= 60000 ? pollIntervalMs : 10000,
    vehicleTypes: vehicleTypes.length ? [...new Set(vehicleTypes)] : ['CAR_4'],
    geocoderUrl: optionalUrl(process.env.EXPO_PUBLIC_GEOCODER_URL),
  };
}
