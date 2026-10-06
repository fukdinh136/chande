import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { realtimeBaseUrl } from './config';
import { SocketLocationClient } from './socket-location-client';
const explanation: Record<string, string> = {
  REALTIME_NOT_CONFIGURED: 'Chưa cấu hình địa chỉ Realtime Service.',
  LOCATION_STALE: 'GPS đo quá lâu. Đang chờ vị trí mới.',
  LOCATION_IN_FUTURE: 'Giờ trên thiết bị lệch về tương lai. Hãy bật giờ tự động.',
  LOCATION_OUT_OF_ORDER: 'GPS đến sai thứ tự. Đang chờ lần đo mới.',
  UNAUTHENTICATED: 'Phiên định vị không hợp lệ hoặc đã hết hạn. Hãy thử đăng nhập lại.',
  DEPENDENCY_UNAVAILABLE: 'Dịch vụ GPS đang lỗi phụ thuộc. Sẽ thử bằng vị trí mới.',
  ACK_TIMEOUT: 'Chưa nhận xác nhận GPS. Sẽ gửi lần đo mới ở chu kỳ sau.',
  GPS_DISCONNECTED: 'GPS chưa kết nối. Đang chờ kết nối lại.',
  RATE_LIMITED: 'GPS gửi quá nhanh. Đang chờ chu kỳ tiếp theo.',
};
export function useDriverGps(enabled: boolean, token: (signal: AbortSignal) => Promise<string>, gatewayBase?:string|null) {
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [message, setMessage] = useState('GPS chưa bật.');
  const [lastAcceptedAt, setLastAcceptedAt] = useState<string | null>(null);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!enabled || !foreground) return;
    let disposed = false, busy = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let client: SocketLocationClient | undefined;
    const controller = new AbortController();
    const publish = (value: string) => { if (!disposed) setMessage(value); };
    const halt = () => { if (timer) clearInterval(timer); client?.stop(); };
    const tick = async () => {
      if (disposed || busy) return;
      busy = true;
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (disposed) return;
        if (!permission.granted || !await Location.hasServicesEnabledAsync()) {
          publish('Quyền vị trí bị từ chối hoặc định vị đã tắt. Hãy bật lại rồi tắt/bật GPS trong app.'); halt(); return;
        }
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (disposed) return;
        const accuracy = position.coords.accuracy;
        if (accuracy === null || !Number.isFinite(accuracy)) { publish('Chưa đo được độ chính xác GPS.'); return; }
        const receipt = await client!.send({ latitude: position.coords.latitude, longitude: position.coords.longitude,
          accuracy, recordedAt: new Date(position.timestamp).toISOString() });
        if (!disposed) { setLastAcceptedAt(receipt.receivedAt); publish('Vị trí đã được cập nhật.'); }
      } catch (error) {
        const code = error instanceof Error ? error.message : '';
        publish(explanation[code] ?? 'Chưa gửi được GPS. Kiểm tra quyền, định vị và kết nối.');
      } finally { busy = false; }
    };
    void (async () => {
      try {
        const base = process.env.EXPO_PUBLIC_DRIVER_REALTIME_BASE_URL ? realtimeBaseUrl() : gatewayBase ?? realtimeBaseUrl();
        const permission = await Location.requestForegroundPermissionsAsync();
        if (disposed) return;
        if (!permission.granted) { publish('Bạn chưa cấp quyền vị trí. Không gửi GPS.'); return; }
        client = new SocketLocationClient(base, () => token(controller.signal), publish, () => { void tick(); });
        client.start();
        timer = setInterval(() => { void tick(); }, 10000);
      } catch (error) {
        const code = error instanceof Error ? error.message : '';
        publish(explanation[code] ?? 'Không thể bật GPS. Kiểm tra cấu hình và quyền vị trí.');
      }
    })();
    return () => { disposed = true; controller.abort(); halt(); };
  }, [enabled, foreground, token, gatewayBase]);
  return { message: enabled && foreground ? message : 'Định vị đang tạm dừng.', lastAcceptedAt };
}
