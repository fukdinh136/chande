import type { Ref } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { LatLng, LngLat } from '../navigation/geo';

export interface MapPadding { top: number; right: number; bottom: number; left: number }

export interface RideMapHandle {
  /** Căn khung theo điểm đón, điểm đến và tuyến. */
  fit(): void;
  centerOn(point: LatLng, zoom?: number): void;
}

export interface RideMapProps {
  ref?: Ref<RideMapHandle>;
  style?: StyleProp<ViewStyle>;
  pickup?: LatLng | null;
  destination?: LatLng | null;
  route?: LngLat[] | null;
  /** Ghim cố định giữa bản đồ để chọn vị trí; `onCenterChange` gọi khi bản đồ dừng di chuyển. */
  pickMode?: boolean;
  onCenterChange?: (center: LatLng) => void;
  initialCenter?: LatLng | null;
  initialZoom?: number;
  showUserLocation?: boolean;
  /** Camera bám theo vị trí và hướng di chuyển (dẫn đường dự phòng). */
  followUser?: boolean;
  padding?: MapPadding;
  /** false: chỉ xem (khi bản đồ nằm trong màn hình cuộn được). */
  interactive?: boolean;
  /** Đổi giá trị để căn khung lại. */
  fitKey?: string | number;
}
