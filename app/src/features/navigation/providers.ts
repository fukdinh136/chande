import { fetch } from 'expo/fetch';
import type { LngLat } from './geo';
import type { PlannedRoute } from './model';
import { routeFromOsrm, routeFromRoutingService, RoutingError } from './routes';

// Nguồn tuyến cho bản đồ và dẫn đường:
// - "gateway": routing-service R02 `POST /routes` và R04 `POST /routes/recalculate` qua API Gateway, kèm JWT người dùng.
// - "osrm": gọi thẳng OSRM tự host (chỉ dùng khi phát triển; OSRM không có xác thực).
export type RoutingMode = 'gateway' | 'osrm';
export interface RoutingConfig {
  mode: RoutingMode;
  baseUrl: string;
  osrmProfile: string;
  vehicleTypeOverride: string | null;
  timeoutMs: number;
}

function cleanBase(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return trimmed;
  } catch { return null; }
}

export function loadRoutingConfig(): RoutingConfig | null {
  // Expo chỉ thay giá trị EXPO_PUBLIC_* khi biến được đọc trực tiếp theo tên.
  const mode = (process.env.EXPO_PUBLIC_ROUTING_MODE ?? 'gateway').trim();
  const timeoutMs = Number(process.env.EXPO_PUBLIC_ROUTING_TIMEOUT_MS ?? 10000);
  const vehicleTypeOverride = process.env.EXPO_PUBLIC_ROUTING_VEHICLE_TYPE?.trim() || null;
  const common = {
    osrmProfile: process.env.EXPO_PUBLIC_OSRM_PROFILE?.trim() || 'driving',
    vehicleTypeOverride: vehicleTypeOverride && /^[A-Za-z0-9_-]{1,32}$/.test(vehicleTypeOverride) ? vehicleTypeOverride : null,
    timeoutMs: Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 60000 ? timeoutMs : 10000,
  };
  if (mode === 'osrm') {
    const baseUrl = cleanBase(process.env.EXPO_PUBLIC_OSRM_BASE_URL);
    return baseUrl ? { mode, baseUrl, ...common } : null;
  }
  if (mode !== 'gateway') return null;
  const explicit = cleanBase(process.env.EXPO_PUBLIC_ROUTING_BASE_URL);
  const gateway = cleanBase(process.env.EXPO_PUBLIC_API_BASE_URL);
  const prefix = (process.env.EXPO_PUBLIC_API_PREFIX ?? '/api/v1').trim().replace(/\/+$/, '');
  const baseUrl = explicit ?? (gateway ? `${gateway}${prefix}/routing` : null);
  return baseUrl ? { mode, baseUrl, ...common } : null;
}

export interface RouteRequest {
  origin: LngLat;
  destination: LngLat;
  vehicleType: string;
  /** Tính lại từ vị trí hiện tại (R04) thay vì tuyến mới (R02). */
  reroute?: boolean;
  signal?: AbortSignal;
}
export interface RouteProvider {
  readonly mode: RoutingMode;
  route(request: RouteRequest): Promise<PlannedRoute>;
}
export type AccessTokenSource = (signal?: AbortSignal) => Promise<string | null>;

async function requestJson(url: string, init: { method: 'GET' | 'POST'; body?: unknown; token?: string | null }, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(url, {
      method: init.method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    let payload: unknown = null;
    try { payload = await response.json(); } catch { if (response.ok) throw new RoutingError('INVALID_PROVIDER_RESPONSE', response.status); }
    if (!response.ok) {
      const envelope = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const error = envelope.error && typeof envelope.error === 'object' ? envelope.error as Record<string, unknown> : {};
      const osrmCode = typeof envelope.code === 'string' ? envelope.code : null;
      if (osrmCode === 'NoRoute' || osrmCode === 'NoSegment') throw new RoutingError('NO_ROUTE', response.status);
      const code = typeof error.code === 'string' && /^[A-Z_]{1,80}$/.test(error.code) ? error.code
        : response.status === 401 ? 'UNAUTHENTICATED' : response.status === 403 ? 'FORBIDDEN_ACTION' : 'DEPENDENCY_UNAVAILABLE';
      throw new RoutingError(code, response.status);
    }
    return payload;
  } catch (error) {
    if (error instanceof RoutingError) throw error;
    if (controller.signal.aborted) throw new RoutingError(timedOut ? 'TIMEOUT' : 'CANCELLED');
    throw new RoutingError('NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

class OsrmRouteProvider implements RouteProvider {
  readonly mode = 'osrm' as const;
  constructor(private readonly config: RoutingConfig) {}
  async route(request: RouteRequest) {
    const coordinates = [request.origin, request.destination].map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
    const url = `${this.config.baseUrl}/route/v1/${encodeURIComponent(this.config.osrmProfile)}/${coordinates}`
      + '?alternatives=false&overview=full&geometries=polyline6&steps=true&continue_straight=true';
    return routeFromOsrm(await requestJson(url, { method: 'GET' }, this.config.timeoutMs, request.signal));
  }
}

class GatewayRouteProvider implements RouteProvider {
  readonly mode = 'gateway' as const;
  constructor(private readonly config: RoutingConfig, private readonly token: AccessTokenSource) {}
  async route(request: RouteRequest) {
    const point = ([lng, lat]: LngLat) => ({ lat, lng });
    const vehicleType = this.config.vehicleTypeOverride ?? request.vehicleType;
    const body = request.reroute
      ? { currentLocation: point(request.origin), destination: point(request.destination), vehicleType, includeSteps: true }
      : { origin: point(request.origin), destination: point(request.destination), vehicleType, includeSteps: true };
    const path = request.reroute ? '/routes/recalculate' : '/routes';
    const token = await this.token(request.signal);
    const payload = await requestJson(`${this.config.baseUrl}${path}`, { method: 'POST', body, token }, this.config.timeoutMs, request.signal);
    if (!payload || typeof payload !== 'object' || !('data' in payload)) throw new RoutingError('INVALID_PROVIDER_RESPONSE');
    return routeFromRoutingService((payload as { data: unknown }).data);
  }
}

export function createRouteProvider(token: AccessTokenSource, config = loadRoutingConfig()): RouteProvider | null {
  if (!config) return null;
  return config.mode === 'osrm' ? new OsrmRouteProvider(config) : new GatewayRouteProvider(config, token);
}

const messages: Record<string, string> = {
  NO_ROUTE: 'Không tìm được đường đi giữa hai điểm.',
  UNSUPPORTED_VEHICLE_TYPE: 'Dịch vụ dẫn đường chưa hỗ trợ loại xe này.',
  NETWORK_ERROR: 'Không kết nối được dịch vụ tìm đường.',
  TIMEOUT: 'Dịch vụ tìm đường phản hồi quá lâu.',
  UNAUTHENTICATED: 'Phiên đăng nhập hết hạn, không gọi được dịch vụ tìm đường.',
  FORBIDDEN_ACTION: 'Gateway chưa mở quyền gọi dịch vụ tìm đường.',
  INVALID_PROVIDER_RESPONSE: 'Dịch vụ tìm đường trả dữ liệu không hợp lệ.',
  ROUTING_BUSY: 'Dịch vụ tìm đường đang quá tải. Thử lại sau giây lát.',
  CANCELLED: 'Đã dừng tìm đường.',
};
export function routingErrorText(error: unknown): string {
  if (error instanceof RoutingError) return messages[error.code] ?? 'Dịch vụ tìm đường tạm thời không khả dụng.';
  return 'Không tìm được đường đi.';
}
