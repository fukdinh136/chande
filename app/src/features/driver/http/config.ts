import { ApiError } from './errors';

export type Service = 'driver' | 'trip' | 'matching' | 'routing';
export interface Capability { configured: boolean; reason: string }
export const REALTIME_NAMESPACE = '/realtime';
export const REALTIME_SOCKET_PATH = '/socket.io/';
export interface HttpConfig {
  mode: 'direct' | 'gateway';
  driverBase: string;
  tripBase: string | null;
  gatewayBase: string | null;
  gatewayPrefix: string;
  matchingBase: string | null;
  matchingPrefix: string;
  realtimeBase: string | null;
  tripEventsBase: string | null;
  routingBase: string | null;
  routingPrefix: string;
  capabilities: Record<'trip' | 'matching' | 'realtime' | 'tripEvents' | 'routing', Capability>;
  timeoutMs: number;
  pollIntervalMs: number;
}
// Normalize Gateway URLs ending in their prefix once, without duplicating /api/v1.
function origin(value: string | undefined, prefix = ''): string {
  if (!value?.trim()) throw new ApiError('CONFIGURATION_REQUIRED');
  try {
    const url = new URL(value.trim());
    const path = url.pathname.replace(/\/$/, '');
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (path && path !== prefix)) throw new Error();
    if (!__DEV__ && url.protocol !== 'https:') throw new Error();
    return url.origin;
  } catch { throw new ApiError('CONFIGURATION_REQUIRED'); }
}
export function driverHttpMode(): HttpConfig['mode'] {
  const mode = process.env.EXPO_PUBLIC_DRIVER_HTTP_MODE ?? (process.env.EXPO_PUBLIC_DRIVER_BASE_URL ? 'direct' : 'gateway');
  if (mode !== 'direct' && mode !== 'gateway') throw new ApiError('CONFIGURATION_REQUIRED');
  return mode;
}
export function driverGatewayOrigin() { return process.env.EXPO_PUBLIC_DRIVER_GATEWAY_BASE_URL; }
export function gatewayContractConfirmed() { return process.env.EXPO_PUBLIC_DRIVER_GATEWAY_CONTRACT_CONFIRMED === 'true'; }
export function loadHttpConfig(connectedGateway?: string): HttpConfig {
  // Literal reads are required for Expo's EXPO_PUBLIC substitution.
  const mode = driverHttpMode();
  const prefix = (process.env.EXPO_PUBLIC_DRIVER_GATEWAY_PREFIX?.trim() || '/api/v1').replace(/\/$/, '');
  const prefixValid = !prefix || (/^\/[A-Za-z0-9/_-]+$/.test(prefix) && !prefix.includes('//') && !prefix.includes('/api/v1/api/v1'));
  if (mode === 'gateway' && !prefixValid) throw new ApiError('INVALID_ROUTE');
  const timeoutMs = Number(process.env.EXPO_PUBLIC_DRIVER_HTTP_TIMEOUT_MS ?? 10000);
  const pollIntervalMs = Number(process.env.EXPO_PUBLIC_DRIVER_TRIP_POLL_MS ?? 15000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000 || !Number.isInteger(pollIntervalMs) || pollIntervalMs < 10000 || pollIntervalMs > 60000) throw new ApiError('CONFIGURATION_REQUIRED');
  const confirmed = gatewayContractConfirmed();
  if (mode === 'gateway' && !confirmed) throw new ApiError('GATEWAY_NOT_CONFIRMED');
  const gatewayBase = mode === 'gateway' ? origin(connectedGateway ?? driverGatewayOrigin(), prefix) : null;
  const driverBase = gatewayBase ?? origin(process.env.EXPO_PUBLIC_DRIVER_BASE_URL);
  const optional = (value: string | undefined | null, name: string, path = ''): { base: string | null; capability: Capability } => {
    if (!value?.trim()) return { base: null, capability: { configured: false, reason: `Chưa cấu hình ${name}.` } };
    try { return { base: origin(value, path), capability: { configured: true, reason: `${name} đã cấu hình; trạng thái kết nối được kiểm tra riêng.` } }; }
    catch { return { base: null, capability: { configured: false, reason: `${name} không hợp lệ. Dùng HTTP(S) origin, không kèm credential, query hoặc đường dẫn khác.` } }; }
  };
  const tripTrusted = process.env.EXPO_PUBLIC_DRIVER_TRIP_TRUST_CONFIRMED === 'true';
  const trip = optional(gatewayBase ?? process.env.EXPO_PUBLIC_DRIVER_TRIP_BASE_URL, 'Trip HTTP', gatewayBase ? prefix : '');
  if (!tripTrusted) { trip.base = null; trip.capability = { configured: false, reason: 'Trip chưa xác nhận cấu hình xác thực tài xế. Chức năng chuyến tạm khóa; hãy liên hệ quản trị.' }; }
  const matchingPrefix = process.env.EXPO_PUBLIC_DRIVER_MATCHING_BASE_URL ? (process.env.EXPO_PUBLIC_DRIVER_MATCHING_PREFIX?.trim() ?? '').replace(/\/$/, '') : prefix;
  const matching = optional(process.env.EXPO_PUBLIC_DRIVER_MATCHING_BASE_URL || gatewayBase, 'Matching HTTP', matchingPrefix);
  if (matchingPrefix && (!/^\/[A-Za-z0-9/_-]+$/.test(matchingPrefix) || matchingPrefix.includes('//') || matchingPrefix.includes('/api/v1/api/v1'))) {
    matching.base = null; matching.capability = { configured: false, reason: 'Cấu hình đường dẫn Matching không hợp lệ.' };
  }
  const realtime = optional(process.env.EXPO_PUBLIC_DRIVER_REALTIME_BASE_URL || (process.env.EXPO_PUBLIC_DRIVER_GATEWAY_REALTIME_CONFIRMED === 'true' ? gatewayBase : null), 'Realtime Socket.IO (/realtime, /socket.io/)');
  const tripEvents = optional(process.env.EXPO_PUBLIC_DRIVER_TRIP_EVENTS_BASE_URL || gatewayBase, 'Trip notification Gateway (/ws)');
  if (!trip.base || !confirmed) { tripEvents.base = null; tripEvents.capability = { configured: false, reason: 'Chưa cấu hình thông báo Trip hoặc xác thực tài xế. Chuyến vẫn được đọc định kỳ khi Trip HTTP đã cấu hình.' }; }
  const routing = optional(process.env.EXPO_PUBLIC_DRIVER_ROUTING_GATEWAY_BASE_URL || gatewayBase, 'Routing qua public Gateway', prefix);
  if (!confirmed) { routing.base = null; routing.capability = { configured: false, reason: 'Điều hướng chưa cấu hình Gateway hỗ trợ tài xế. Hãy liên hệ quản trị.' }; }
  else if (!prefixValid) { routing.base = null; routing.capability = { configured: false, reason: 'Cấu hình đường dẫn Gateway cho điều hướng không hợp lệ.' }; }
  return {
    mode, driverBase, tripBase: trip.base, gatewayBase, gatewayPrefix: prefix,
    matchingBase: matching.base, matchingPrefix,
    realtimeBase: realtime.base, tripEventsBase: tripEvents.base,
    routingBase: routing.base, routingPrefix: prefix,
    capabilities: { trip: trip.capability, matching: matching.capability, realtime: realtime.capability, tripEvents: tripEvents.capability, routing: routing.capability },
    timeoutMs, pollIntervalMs,
  };
}
