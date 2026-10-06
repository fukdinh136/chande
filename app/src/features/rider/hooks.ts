import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import type { LatLng } from '../navigation/geo';
import { RiderError } from './errors';
import { formatCoordinates } from './format';
import type { Geocoder } from './geocoder';
import type { Place } from './models';

/** Thời điểm hiện tại, cập nhật theo chu kỳ khi `enabled` (đếm ngược báo giá). */
export function useNow(enabled: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs]);
  return now;
}

/** Gọi `job` ngay khi màn hình có focus và lặp lại theo chu kỳ khi app ở foreground. */
export function useFocusPolling(job: () => void, intervalMs: number | null) {
  useFocusEffect(useCallback(() => {
    job();
    if (intervalMs === null) return;
    let timer: ReturnType<typeof setInterval> | null = setInterval(job, intervalMs);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        job();
        if (!timer) timer = setInterval(job, intervalMs);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });
    return () => {
      if (timer) clearInterval(timer);
      subscription.remove();
    };
  }, [job, intervalMs]));
}

export async function currentPosition(): Promise<LatLng> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new RiderError('LOCATION_DENIED');
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 60000, requiredAccuracy: 200 });
    const position = last ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch {
    throw new RiderError('LOCATION_UNAVAILABLE');
  }
}

/** Tên hiển thị cho một toạ độ: Photon nếu đã cấu hình, nếu không thì geocoder của hệ điều hành (best effort). */
export async function describePoint(point: LatLng, geocoder: Geocoder | null): Promise<string> {
  try {
    if (geocoder) {
      const place = await geocoder.reverse(point);
      if (place) return place.subtitle ? `${place.title}, ${place.subtitle}` : place.title;
    } else if (Platform.OS !== 'web') {
      const [result] = await Location.reverseGeocodeAsync({ latitude: point.lat, longitude: point.lng });
      const text = [result?.streetNumber, result?.street].filter(Boolean).join(' ') || result?.name;
      const area = result?.district ?? result?.subregion ?? result?.city;
      if (text) return area ? `${text}, ${area}` : text;
    }
  } catch { /* Không có tên vẫn dùng được toạ độ. */ }
  return formatCoordinates(point.lat, point.lng);
}

export const toPlace = (point: LatLng, address: string): Place => ({ lat: point.lat, lng: point.lng, address: address.slice(0, 500) });
