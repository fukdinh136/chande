import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '@/design';
import { boundsOf, toLngLat, type LngLat } from '../navigation/geo';
import { MAP_DEFAULT_CENTER, MAP_STYLE_URL } from './config';
import { CenterPin } from './markers';
import type { RideMapProps } from './types';

// Bản web dùng maplibre-gl 5 (bản UMD chạy được với Metro). Cùng props với bản native ride-map.tsx.
// Thư viện được nạp động trong effect: nó truy cập window khi import, còn web.output "static" render trang trong Node.
type MapLibreModule = typeof import('maplibre-gl');
const DEFAULT_PADDING = { top: 64, right: 48, bottom: 48, left: 48 };
const ROUTE_SOURCE = 'chande-route';

function markerElement(kind: 'pickup' | 'destination' | 'user'): HTMLElement {
  const element = document.createElement('div');
  const fill = kind === 'pickup' ? colors.tertiary : kind === 'destination' ? colors.error : colors.route;
  const size = kind === 'user' ? 16 : 22;
  Object.assign(element.style, {
    width: `${size}px`, height: `${size}px`, borderRadius: '50%', background: fill,
    border: `3px solid ${colors.surfaceContainerLowest}`, boxShadow: '0 4px 10px rgba(15, 23, 42, 0.25)',
  });
  if (kind === 'pickup') element.style.outline = '6px solid rgba(82, 224, 120, 0.35)';
  return element;
}

export function RideMap({
  ref, style, pickup, destination, route, pickMode = false, onCenterChange, initialCenter, initialZoom = 14,
  showUserLocation = false, followUser = false, padding = DEFAULT_PADDING, interactive = true, fitKey,
}: RideMapProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const library = useRef<MapLibreModule | null>(null);
  const markers = useRef<Partial<Record<'pickup' | 'destination' | 'user', Marker>>>({});
  const callbacks = useRef({ pickMode, onCenterChange });
  const [loaded, setLoaded] = useState(false);
  const [initial] = useState<LngLat>(() => toLngLat(initialCenter ?? pickup ?? MAP_DEFAULT_CENTER));
  const points = useMemo(() => {
    const list: LngLat[] = route?.length ? [...route] : [];
    if (pickup) list.push(toLngLat(pickup));
    if (destination) list.push(toLngLat(destination));
    return list;
  }, [route, pickup, destination]);

  useEffect(() => {
    callbacks.current = { pickMode, onCenterChange };
  }, [pickMode, onCenterChange]);

  useEffect(() => {
    let disposed = false;
    let instance: MapLibreMap | null = null;
    void import('maplibre-gl').then((gl) => {
      if (disposed || !container.current) return;
      library.current = gl;
      const created = new gl.Map({
        container: container.current, style: MAP_STYLE_URL, center: initial, zoom: initialZoom,
        attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
      });
      created.on('load', () => setLoaded(true));
      created.on('moveend', () => {
        const { pickMode: picking, onCenterChange: notify } = callbacks.current;
        if (!picking || !notify) return;
        const center = created.getCenter();
        notify({ lat: center.lat, lng: center.lng });
      });
      instance = created;
      map.current = created;
    });
    return () => {
      disposed = true;
      instance?.remove();
      map.current = null;
      markers.current = {};
    };
  }, [initial, initialZoom]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    if (interactive) {
      instance.dragPan.enable(); instance.scrollZoom.enable(); instance.doubleClickZoom.enable(); instance.touchZoomRotate.enable();
    } else {
      instance.dragPan.disable(); instance.scrollZoom.disable(); instance.doubleClickZoom.disable(); instance.touchZoomRotate.disable();
    }
  }, [interactive, loaded]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !loaded) return;
    const data = route && route.length >= 2
      ? { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: route } }
      : { type: 'FeatureCollection' as const, features: [] };
    const source = instance.getSource<GeoJSONSource>(ROUTE_SOURCE);
    if (source) {
      source.setData(data);
      return;
    }
    instance.addSource(ROUTE_SOURCE, { type: 'geojson', data });
    instance.addLayer({ id: 'chande-route-casing', type: 'line', source: ROUTE_SOURCE, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': colors.secondaryFixed, 'line-width': 9 } });
    instance.addLayer({ id: 'chande-route-line', type: 'line', source: ROUTE_SOURCE, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': colors.primary, 'line-width': 4.5, 'line-dasharray': [1.6, 1] } });
  }, [route, loaded]);

  useEffect(() => {
    const instance = map.current;
    const gl = library.current;
    if (!instance || !gl) return;
    const place = (kind: 'pickup' | 'destination', point: LngLat | null) => {
      const existing = markers.current[kind];
      if (!point) {
        existing?.remove();
        delete markers.current[kind];
        return;
      }
      if (existing) existing.setLngLat(point);
      else markers.current[kind] = new gl.Marker({ element: markerElement(kind) }).setLngLat(point).addTo(instance);
    };
    place('pickup', pickup && !pickMode ? toLngLat(pickup) : null);
    place('destination', destination && !pickMode ? toLngLat(destination) : null);
  }, [pickup, destination, pickMode, loaded]);

  useEffect(() => {
    const instance = map.current;
    const gl = library.current;
    if (!instance || !gl || !showUserLocation || typeof navigator === 'undefined' || !navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition((position) => {
      const point: LngLat = [position.coords.longitude, position.coords.latitude];
      const existing = markers.current.user;
      if (existing) existing.setLngLat(point);
      else markers.current.user = new gl.Marker({ element: markerElement('user') }).setLngLat(point).addTo(instance);
      if (followUser) instance.easeTo({ center: point, zoom: Math.max(instance.getZoom(), 16), duration: 500 });
    }, () => {}, { enableHighAccuracy: true, maximumAge: 2000 });
    return () => {
      navigator.geolocation.clearWatch(watch);
      markers.current.user?.remove();
      delete markers.current.user;
    };
  }, [showUserLocation, followUser, loaded]);

  const fit = useCallback(() => {
    const instance = map.current;
    const bounds = boundsOf(points);
    if (!instance || !bounds) return;
    const [west, south, east, north] = bounds;
    if (Math.abs(east - west) < 1e-4 && Math.abs(north - south) < 1e-4) instance.easeTo({ center: [west, south], zoom: 16, padding, duration: 500 });
    else instance.fitBounds([[west, south], [east, north]], { padding, duration: 600 });
  }, [points, padding]);

  useImperativeHandle(ref, () => ({
    fit,
    centerOn: (point, zoom = 16) => map.current?.easeTo({ center: toLngLat(point), zoom, duration: 500 }),
  }), [fit]);

  // Chỉ căn khung khi fitKey đổi (điểm/tuyến khác), không phải mỗi lần cha render lại với object mới.
  const latestFit = useRef(fit);
  useEffect(() => { latestFit.current = fit; });
  useEffect(() => {
    if (loaded && !pickMode && !followUser) latestFit.current();
  }, [loaded, fitKey, pickMode, followUser]);

  return (
    <View style={[styles.container, style]}>
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      {pickMode ? <CenterPin /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', backgroundColor: colors.surfaceContainerHigh },
});
