import type { LngLat } from './geo';

// Tập giá trị khớp enum StepManeuver.Type / ManeuverModifier.Type của MapLibre Navigation SDK:
// giá trị lạ sẽ làm SDK từ chối parse tuyến, nên mọi nguồn tuyến phải chuẩn hoá về đây.
export const MANEUVER_TYPES = [
  'turn', 'new name', 'depart', 'arrive', 'merge', 'on ramp', 'off ramp', 'fork', 'end of road', 'continue',
  'roundabout', 'rotary', 'roundabout turn', 'notification', 'exit roundabout', 'exit rotary', 'use lane',
] as const;
export type ManeuverType = typeof MANEUVER_TYPES[number];
export const MANEUVER_MODIFIERS = ['uturn', 'sharp right', 'right', 'slight right', 'straight', 'slight left', 'left', 'sharp left'] as const;
export type ManeuverModifier = typeof MANEUVER_MODIFIERS[number];

export interface Maneuver {
  type: ManeuverType;
  modifier: ManeuverModifier | null;
  location: LngLat;
  bearingBefore: number;
  bearingAfter: number;
  exit: number | null;
}
export interface Intersection { location: LngLat; bearings: number[]; entry: boolean[]; in?: number; out?: number }
export interface RouteStep {
  /** Mét, đo trên chính `geometry` để khớp cách SDK tính quãng đường còn lại. */
  distance: number;
  duration: number;
  name: string;
  geometry: LngLat[];
  maneuver: Maneuver;
  /** Ít nhất một phần tử: SDK lấy phần tử đầu làm giao lộ hiện tại. */
  intersections: Intersection[];
}
export interface PlannedRoute {
  distance: number;
  duration: number;
  geometry: LngLat[];
  steps: RouteStep[];
  source: 'osrm' | 'routing-service';
}

export function maneuverModifier(value: unknown): ManeuverModifier | null {
  return MANEUVER_MODIFIERS.includes(value as ManeuverModifier) ? value as ManeuverModifier : null;
}
export function maneuverType(value: unknown, modifier: ManeuverModifier | null): ManeuverType {
  if (MANEUVER_TYPES.includes(value as ManeuverType)) return value as ManeuverType;
  if (value === 'ramp') return 'on ramp';
  return modifier && modifier !== 'straight' ? 'turn' : 'continue';
}
