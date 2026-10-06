import { bearing, cumulativeDistances, lineLength, nearestOnLine, sliceAlong, type LngLat } from './geo';
import { maneuverModifier, maneuverType, type Intersection, type ManeuverModifier, type ManeuverType, type PlannedRoute, type RouteStep } from './model';
import { decodePolyline } from './polyline';

export class RoutingError extends Error {
  constructor(public readonly code: string, public readonly status = 0) {
    super(code);
    this.name = 'RoutingError';
  }
}

const invalid = () => new RoutingError('INVALID_PROVIDER_RESPONSE');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw invalid();
  return value;
}
function finite(value: unknown, fallback?: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (fallback !== undefined) return fallback;
  throw invalid();
}
function lngLat(value: unknown): LngLat {
  const pair = array(value);
  const lng = finite(pair[0]), lat = finite(pair[1]);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw invalid();
  return [lng, lat];
}
function polyline(value: unknown): LngLat[] {
  if (typeof value !== 'string') throw invalid();
  try { return decodePolyline(value, 6); } catch { throw invalid(); }
}
const positiveInt = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null);

function intersection(value: unknown): Intersection {
  const data = object(value);
  const bearings = Array.isArray(data.bearings) ? data.bearings.filter((item): item is number => typeof item === 'number') : [];
  const entry = Array.isArray(data.entry) ? data.entry.filter((item): item is boolean => typeof item === 'boolean') : [];
  return {
    location: lngLat(data.location),
    bearings,
    entry: entry.length === bearings.length ? entry : bearings.map(() => true),
    ...(typeof data.in === 'number' ? { in: data.in } : {}),
    ...(typeof data.out === 'number' ? { out: data.out } : {}),
  };
}

/** Chuẩn hoá phản hồi `GET /route/v1/{profile}/...?steps=true&geometries=polyline6&overview=full` của OSRM. */
export function routeFromOsrm(payload: unknown): PlannedRoute {
  const body = object(payload);
  if (body.code === 'NoRoute' || body.code === 'NoSegment') throw new RoutingError('NO_ROUTE');
  if (body.code !== 'Ok') throw invalid();
  const route = object(array(body.routes)[0]);
  const geometry = polyline(route.geometry);
  const steps = array(route.legs).flatMap((leg) => array(object(leg).steps)).map((value): RouteStep => {
    const step = object(value);
    const maneuver = object(step.maneuver);
    const location = lngLat(maneuver.location);
    const modifier = maneuverModifier(maneuver.modifier);
    const shape = polyline(step.geometry);
    const name = typeof step.name === 'string' && step.name.trim() ? step.name.trim() : typeof step.ref === 'string' ? step.ref.trim() : '';
    return {
      distance: shape.length >= 2 ? lineLength(shape) : 0,
      duration: finite(step.duration, 0),
      name,
      geometry: shape.length >= 2 ? shape : [location, location],
      maneuver: {
        type: maneuverType(maneuver.type, modifier), modifier, location,
        bearingBefore: finite(maneuver.bearing_before, 0), bearingAfter: finite(maneuver.bearing_after, 0),
        exit: positiveInt(maneuver.exit),
      },
      intersections: Array.isArray(step.intersections) ? step.intersections.map(intersection) : [],
    };
  });
  // Tuyến nhiều chặng có "arrive" ở giữa; app chỉ dẫn đường một chặng nên giữ lại "arrive" cuối cùng.
  const filtered = steps.filter((step, index) => step.maneuver.type !== 'arrive' || index === steps.length - 1);
  return finalize({ distance: finite(route.distance), duration: finite(route.duration), geometry, steps: filtered, source: 'osrm' });
}

interface ServiceStep { distance: number; duration: number; name: string; type: ManeuverType; modifier: ManeuverModifier | null; location: LngLat; exit: number | null }

/** Chuẩn hoá `data` của routing-service R02/R04 (`includeSteps=true`). Bước không có hình học nên cắt từ polyline tổng. */
export function routeFromRoutingService(payload: unknown): PlannedRoute {
  const data = object(payload);
  const line = object(data.polyline);
  if (line.precision !== 6) throw invalid();
  const geometry = polyline(line.value);
  if (geometry.length < 2) throw invalid();
  const duration = finite(data.durationSeconds);
  const raw: ServiceStep[] = (Array.isArray(data.steps) ? data.steps : []).map((value) => {
    const step = object(value);
    const maneuver = object(step.maneuver);
    const location = object(maneuver.location);
    const modifier = maneuverModifier(maneuver.modifier);
    return {
      distance: finite(step.distanceMeters, 0), duration: finite(step.durationSeconds, 0),
      name: typeof step.streetName === 'string' ? step.streetName.trim() : '',
      type: maneuverType(maneuver.type, modifier), modifier,
      location: lngLat([location.lng, location.lat]), exit: positiveInt(maneuver.exit),
    };
  });
  return finalize({ distance: finite(data.distanceMeters), duration, geometry, steps: splitSteps(geometry, raw, duration), source: 'routing-service' });
}

function splitSteps(geometry: LngLat[], input: ServiceStep[], totalDuration: number): RouteStep[] {
  const cumulative = cumulativeDistances(geometry);
  const total = cumulative[cumulative.length - 1];
  const raw = [...input];
  if (!raw.length || raw[0].type !== 'depart') {
    raw.unshift({ distance: raw.length ? 0 : total, duration: raw.length ? 0 : totalDuration, name: '', type: 'depart', modifier: null, location: geometry[0], exit: null });
  }
  if (raw[raw.length - 1].type !== 'arrive') {
    raw.push({ distance: 0, duration: 0, name: '', type: 'arrive', modifier: null, location: geometry[geometry.length - 1], exit: null });
  }
  const starts = [0];
  let segment = 0;
  for (let i = 1; i < raw.length; i++) {
    if (i === raw.length - 1) { starts.push(total); break; }
    const position = nearestOnLine(geometry, raw[i].location, {
      cumulative, fromSegment: segment, expectedAlong: starts[i - 1] + raw[i - 1].distance,
    });
    segment = position.segment;
    starts.push(Math.min(total, Math.max(starts[i - 1], position.along)));
  }
  let previousBearing = 0;
  return raw.map((step, i): RouteStep => {
    const end = i + 1 < starts.length ? starts[i + 1] : total;
    const shape = sliceAlong(geometry, cumulative, starts[i], end);
    const distance = end - starts[i];
    const after = distance > 0.5 ? bearing(shape[0], shape[1]) : previousBearing;
    const before = i === 0 ? 0 : previousBearing;
    const last = shape.length >= 2 && distance > 0.5 ? bearing(shape[shape.length - 2], shape[shape.length - 1]) : after;
    previousBearing = last;
    return {
      distance,
      duration: step.duration || (total > 0 ? totalDuration * (distance / total) : 0),
      name: step.name,
      geometry: shape,
      maneuver: { type: step.type, modifier: step.modifier, location: shape[0], bearingBefore: before, bearingAfter: after, exit: step.exit },
      intersections: [{ location: shape[0], bearings: [Math.round(after)], entry: [true], out: 0 }],
    };
  });
}

/** Bảo đảm tuyến có bước "depart" đầu, "arrive" cuối và mỗi bước có giao lộ, theo yêu cầu của Navigation SDK. */
function finalize(route: PlannedRoute): PlannedRoute {
  const steps = route.steps.map((step) => ({
    ...step,
    intersections: step.intersections.length ? step.intersections
      : [{ location: step.geometry[0], bearings: [Math.round(step.maneuver.bearingAfter)], entry: [true], out: 0 }],
  }));
  const end = route.geometry[route.geometry.length - 1];
  if (!steps.length) {
    const bearingAfter = route.geometry.length >= 2 ? bearing(route.geometry[0], route.geometry[1]) : 0;
    steps.push({
      distance: lineLength(route.geometry), duration: route.duration, name: '', geometry: route.geometry,
      maneuver: { type: 'depart', modifier: null, location: route.geometry[0], bearingBefore: 0, bearingAfter, exit: null },
      intersections: [{ location: route.geometry[0], bearings: [Math.round(bearingAfter)], entry: [true], out: 0 }],
    });
  }
  if (steps[steps.length - 1].maneuver.type !== 'arrive') {
    const previous = steps[steps.length - 1];
    steps.push({
      distance: 0, duration: 0, name: previous.name, geometry: [end, end],
      maneuver: { type: 'arrive', modifier: null, location: end, bearingBefore: previous.maneuver.bearingAfter, bearingAfter: 0, exit: null },
      intersections: [{ location: end, bearings: [0], entry: [true], in: 0 }],
    });
  }
  return { ...route, steps };
}
