import { NativeModule, requireOptionalNativeModule } from 'expo';

// Cầu nối tới MapLibre Navigation SDK for Android (xem android/). Chỉ có trong Android development build;
// iOS, web và Expo Go nhận `null` và dùng màn hình dẫn đường dự phòng viết bằng JS.
export type NavigationEndReason = 'cancelled' | 'arrived' | 'error';

export interface NavigationProgressEvent {
  distanceRemaining: number;
  durationRemaining: number;
  fractionTraveled: number;
  legIndex: number;
  stepIndex: number;
  stepDistanceRemaining: number;
  latitude: number;
  longitude: number;
}
export interface NavigationLocationEvent { latitude: number; longitude: number }
export interface NavigationEndedEvent { reason: NavigationEndReason; message: string | null }

export type ChandeNavigationEvents = {
  onRunning: (event: Record<string, never>) => void;
  onProgress: (event: NavigationProgressEvent) => void;
  /** SDK phát hiện lệch tuyến. App tự gọi routing-service rồi `updateRoute`; SDK không tự tính lại tuyến. */
  onOffRoute: (event: NavigationLocationEvent) => void;
  onArrival: (event: Record<string, never>) => void;
  onEnded: (event: NavigationEndedEvent) => void;
};

export interface StartNavigationOptions {
  /** JSON DirectionsRoute (Mapbox Directions v5) do `toDirectionsRoute` dựng. */
  routeJson: string;
  /** Chạy giả lập dọc tuyến bằng ReplayRouteLocationEngine thay cho GPS. */
  simulate: boolean;
}

declare class ChandeNavigationNativeModule extends NativeModule<ChandeNavigationEvents> {
  start(options: StartNavigationOptions): Promise<void>;
  /** Trả về `false` khi màn hình dẫn đường không còn mở. */
  updateRoute(routeJson: string): Promise<boolean>;
  stop(): Promise<void>;
  isActive(): boolean;
}

export default requireOptionalNativeModule<ChandeNavigationNativeModule>('ChandeNavigation');
