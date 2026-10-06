import { Camera, GeoJSONSource, Layer, Map, Marker, NativeUserLocation, type CameraRef } from '@maplibre/maplibre-react-native';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '@/design';
import { boundsOf, toLngLat, type LngLat } from '../navigation/geo';
import { MAP_DEFAULT_CENTER, MAP_STYLE_URL } from './config';
import { CenterPin, DestinationMarker, PickupMarker } from './markers';
import type { RideMapProps } from './types';

const DEFAULT_PADDING = { top: 64, right: 48, bottom: 48, left: 48 };

/** Bản đồ MapLibre (iOS/Android) dùng chung cho đặt xe, chọn điểm và dẫn đường dự phòng. */
export function RideMap({
  ref, style, pickup, destination, route, pickMode = false, onCenterChange, initialCenter, initialZoom = 14,
  showUserLocation = false, followUser = false, padding = DEFAULT_PADDING, interactive = true, fitKey,
}: RideMapProps) {
  const camera = useRef<CameraRef>(null);
  const [loaded, setLoaded] = useState(false);
  const [initial] = useState<LngLat>(() => toLngLat(initialCenter ?? pickup ?? MAP_DEFAULT_CENTER));
  const points = useMemo(() => {
    const list: LngLat[] = route?.length ? [...route] : [];
    if (pickup) list.push(toLngLat(pickup));
    if (destination) list.push(toLngLat(destination));
    return list;
  }, [route, pickup, destination]);
  const routeFeature = useMemo(() => (route && route.length >= 2
    ? { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: route } }
    : null), [route]);

  const fit = useCallback(() => {
    const bounds = boundsOf(points);
    if (!bounds || !camera.current) return;
    const [west, south, east, north] = bounds;
    if (Math.abs(east - west) < 1e-4 && Math.abs(north - south) < 1e-4) {
      camera.current.easeTo({ center: [west, south], zoom: 16, padding, duration: 500 });
    } else {
      camera.current.fitBounds(bounds, { padding, duration: 600 });
    }
  }, [points, padding]);

  useImperativeHandle(ref, () => ({
    fit,
    centerOn: (point, zoom = 16) => camera.current?.easeTo({ center: toLngLat(point), zoom, duration: 500 }),
  }), [fit]);

  // Chỉ căn khung khi fitKey đổi (điểm/tuyến khác), không phải mỗi lần cha render lại với object mới.
  const latestFit = useRef(fit);
  useEffect(() => { latestFit.current = fit; });
  useEffect(() => {
    if (loaded && !pickMode && !followUser) latestFit.current();
  }, [loaded, fitKey, pickMode, followUser]);

  return (
    <View style={[styles.container, style]}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLE_URL}
        logo={false}
        compass={false}
        attributionPosition={{ bottom: 8, left: 8 }}
        dragPan={interactive}
        touchZoom={interactive}
        doubleTapZoom={interactive}
        touchRotate={false}
        touchPitch={false}
        onDidFinishLoadingStyle={() => setLoaded(true)}
        onRegionDidChange={(event) => {
          if (!pickMode || !onCenterChange) return;
          const [lng, lat] = event.nativeEvent.center;
          onCenterChange({ lat, lng });
        }}>
        <Camera ref={camera} initialViewState={{ center: initial, zoom: initialZoom }} trackUserLocation={followUser ? 'course' : undefined} />
        {routeFeature ? (
          <GeoJSONSource id="chande-route" data={routeFeature}>
            <Layer id="chande-route-casing" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': colors.secondaryFixed, 'line-width': 9 }} />
            <Layer id="chande-route-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': colors.primary, 'line-width': 4.5, 'line-dasharray': [1.6, 1] }} />
          </GeoJSONSource>
        ) : null}
        {pickup && !pickMode ? (
          <Marker id="chande-pickup" lngLat={toLngLat(pickup)} anchor="center"><PickupMarker /></Marker>
        ) : null}
        {destination && !pickMode ? (
          <Marker id="chande-destination" lngLat={toLngLat(destination)} anchor="center"><DestinationMarker /></Marker>
        ) : null}
        {showUserLocation ? <NativeUserLocation mode={followUser ? 'course' : 'default'} /> : null}
      </Map>
      {pickMode ? <CenterPin /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', backgroundColor: colors.surfaceContainerHigh },
});
