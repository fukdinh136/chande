import type { Sample } from '../../map/location-store';

export interface GpsLimits { freshnessMs: number; maxAccuracyMeters: number; maxFutureMs: number }
export type GpsSample = Omit<Sample, 'accuracy'> & { accuracy: number | null };
export const GPS_SEND_INTERVAL_MS = 10000;
// Public validation limits must match the Realtime deployment. Never credentials.
export function gpsLimits(): GpsLimits | null {
  const freshnessMs = Number(process.env.EXPO_PUBLIC_DRIVER_GPS_FRESHNESS_MS ?? 30000);
  const maxAccuracyMeters = Number(process.env.EXPO_PUBLIC_DRIVER_GPS_MAX_ACCURACY_METERS ?? 100);
  const maxFutureMs = Number(process.env.EXPO_PUBLIC_DRIVER_GPS_MAX_FUTURE_MS ?? 5000);
  return Number.isInteger(freshnessMs) && freshnessMs >= 1 && freshnessMs <= 30000 &&
    Number.isInteger(maxAccuracyMeters) && maxAccuracyMeters >= 1 && maxAccuracyMeters <= 1000 &&
    Number.isInteger(maxFutureMs) && maxFutureMs >= 1 && maxFutureMs <= 10000
    ? { freshnessMs, maxAccuracyMeters, maxFutureMs } : null;
}
export function sampleIssue(sample: GpsSample | null, now: number, limits: GpsLimits): string | null {
  if (!sample) return 'GPS_SEARCHING';
  if (!Number.isFinite(sample.lat) || Math.abs(sample.lat) > 85.05112878 || !Number.isFinite(sample.lng) || Math.abs(sample.lng) > 180 ||
    !Number.isFinite(sample.timestamp) || sample.timestamp < 0 || sample.timestamp > 8640000000000000) return 'INVALID_LOCATION';
  if (sample.timestamp > now + limits.maxFutureMs) return 'LOCATION_IN_FUTURE';
  if (now - sample.timestamp >= limits.freshnessMs) return 'LOCATION_STALE';
  if (sample.accuracy === null || !Number.isFinite(sample.accuracy) || sample.accuracy < 0 || sample.accuracy > limits.maxAccuracyMeters) return 'LOW_ACCURACY';
  return null;
}
export const gpsExplanation: Record<string, string> = {
  GPS_SEARCHING: 'Đang tìm vị trí GPS mới.',
  INVALID_LOCATION: 'Thiết bị trả vị trí không hợp lệ. Chưa gửi vị trí này.',
  LOW_ACCURACY: 'Độ chính xác GPS chưa đạt. Hãy ra nơi thoáng hoặc bật vị trí chính xác.',
  LOCATION_STALE: 'Vị trí đã cũ. Đang chờ lần đo mới.',
  LOCATION_IN_FUTURE: 'Giờ trên thiết bị lệch về tương lai. Hãy bật ngày giờ tự động.',
  LOCATION_OUT_OF_ORDER: 'Server từ chối thứ tự GPS. Chờ lần đo mới và kiểm tra giờ thiết bị.',
  INVALID_REQUEST: 'Realtime từ chối mẫu GPS. Cần kiểm tra ngưỡng accuracy/thời gian của deployment.',
  UNAUTHENTICATED: 'Realtime chưa chấp nhận phiên. Kiểm tra phiên đăng nhập và cấu hình xác thực.',
  SESSION_UNAVAILABLE: 'Phiên định vị đang tạm dừng để phục hồi đăng nhập.',
  REFRESH_UNCERTAIN: 'Phiên cần được phục hồi trước khi kết nối GPS.',
  DEPENDENCY_UNAVAILABLE: 'Dịch vụ GPS tạm thời chưa sẵn sàng. Sẽ gửi lần đo mới ở chu kỳ sau.',
  ACK_TIMEOUT: 'Chưa nhận xác nhận GPS. Không gửi lại mẫu cũ; chờ lần đo mới.',
  INVALID_ACK: 'Xác nhận GPS không khớp mẫu đã gửi. Chưa coi vị trí là được chấp nhận.',
  RATE_LIMITED: 'Server giới hạn tần suất GPS. Chờ chu kỳ tiếp theo.',
  GPS_DISCONNECTED: 'Mất kết nối GPS. Đang chờ kết nối lại.',
  LOCATION_ERROR: 'Chưa lấy được vị trí. Kiểm tra quyền và định vị rồi thử lại.',
};
