import { ApiError } from './errors';

export type Service = 'driver' | 'trip';
export interface HttpConfig {
  mode: 'direct' | 'gateway';
  driverBase: string;
  tripBase: string | null;
  gatewayBase: string | null;
  gatewayPrefix: string;
  timeoutMs: number;
  pollIntervalMs: number;
}
function baseUrl(value: string | undefined): string {
  if (!value?.trim()) throw new ApiError('CONFIGURATION_REQUIRED');
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    if (!__DEV__ && url.protocol !== 'https:') throw new Error();
    return url.toString().replace(/\/$/, '');
  } catch { throw new ApiError('CONFIGURATION_REQUIRED'); }
}
export function loadHttpConfig(): HttpConfig {
  // Literal reads are required for Expo's EXPO_PUBLIC substitution.
  const mode = process.env.EXPO_PUBLIC_DRIVER_HTTP_MODE ?? 'direct';
  if (mode !== 'direct' && mode !== 'gateway') throw new ApiError('CONFIGURATION_REQUIRED');
  const prefix = process.env.EXPO_PUBLIC_DRIVER_GATEWAY_PREFIX ?? '';
  if (prefix && (!/^\/[A-Za-z0-9/_-]+$/.test(prefix) || prefix.includes('//'))) throw new ApiError('INVALID_ROUTE');
  const timeoutMs = Number(process.env.EXPO_PUBLIC_DRIVER_HTTP_TIMEOUT_MS ?? 10000);
  const pollIntervalMs = Number(process.env.EXPO_PUBLIC_DRIVER_TRIP_POLL_MS ?? 15000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000 || !Number.isInteger(pollIntervalMs) || pollIntervalMs < 10000 || pollIntervalMs > 60000) throw new ApiError('CONFIGURATION_REQUIRED');
  if (mode === 'gateway' && process.env.EXPO_PUBLIC_DRIVER_GATEWAY_CONTRACT_CONFIRMED !== 'true') throw new ApiError('GATEWAY_NOT_CONFIRMED');
  const gatewayBase = mode === 'gateway' ? baseUrl(process.env.EXPO_PUBLIC_DRIVER_GATEWAY_BASE_URL) : null;
  const driverBase = gatewayBase ?? baseUrl(process.env.EXPO_PUBLIC_DRIVER_BASE_URL);
  const tripEnabled = process.env.EXPO_PUBLIC_DRIVER_TRIP_TRUST_CONFIRMED === 'true';
  const tripBase = tripEnabled
    ? gatewayBase ?? baseUrl(process.env.EXPO_PUBLIC_DRIVER_TRIP_BASE_URL)
    : null;
  return { mode, driverBase, tripBase, gatewayBase, gatewayPrefix: prefix.replace(/\/$/, ''), timeoutMs, pollIntervalMs };
}
