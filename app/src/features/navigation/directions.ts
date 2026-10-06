import type { LngLat } from './geo';
import { capitalize, imminentPhrase, maneuverPhrase, sentence, spokenDistance, upcomingPhrase, type InstructionContext } from './instructions';
import type { PlannedRoute, RouteStep } from './model';
import { encodePolyline } from './polyline';

// Dựng JSON đúng model DirectionsRoute của MapLibre Navigation SDK (kotlinx.serialization):
// - routeOptions bắt buộc có voice_instructions/banner_instructions = true, nếu không SDK ném lỗi khi bắt đầu;
// - mỗi bước cần geometry polyline6, bearing_before/after và ít nhất một giao lộ;
// - banner của bước i mô tả thao tác ở cuối bước (tức thao tác của bước i + 1), như Directions API v5.

/** Bán kính coi là đã đến nơi; khớp metersRemainingTillArrival mặc định của SDK. */
const ARRIVAL_ZONE_M = 40;
/** Cộng thêm để banner/voice đầu bước luôn ≥ quãng đường còn lại SDK đo bằng turf. */
const START_MARGIN_M = 10;

const round1 = (value: number) => Math.round(value * 10) / 10;

interface BannerText { text: string; type: string; modifier?: string; components: { text: string; type: 'text' }[] }
interface BannerInstructions { distanceAlongGeometry: number; primary: BannerText }
interface VoiceInstructions { distanceAlongGeometry: number; announcement: string; ssmlAnnouncement: string }

function bannerText(text: string, step: RouteStep): BannerText {
  const value = capitalize(text);
  return {
    text: value,
    type: step.maneuver.type,
    ...(step.maneuver.modifier ? { modifier: step.maneuver.modifier } : {}),
    components: [{ text: value, type: 'text' }],
  };
}

function escapeXml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function voice(distanceAlongGeometry: number, announcement: string): VoiceInstructions {
  return { distanceAlongGeometry: round1(distanceAlongGeometry), announcement, ssmlAnnouncement: `<speak>${escapeXml(announcement)}</speak>` };
}

function banners(steps: RouteStep[], index: number, context: InstructionContext): BannerInstructions[] {
  const step = steps[index];
  const next = steps[index + 1];
  if (!next) return [{ distanceAlongGeometry: 0, primary: bannerText(maneuverPhrase(step, context), step) }];
  const start = { distanceAlongGeometry: round1(step.distance + START_MARGIN_M), primary: bannerText(upcomingPhrase(next, context), next) };
  if (next.maneuver.type !== 'arrive') return [start];
  // Banner cuối của bước trước điểm đích là tín hiệu "đã đến nơi" (RouteUtils.isArrivalEvent so với phần tử cuối).
  return [start, { distanceAlongGeometry: round1(Math.min(ARRIVAL_ZONE_M, step.distance)), primary: bannerText(maneuverPhrase(next, context), next) }];
}

function voices(steps: RouteStep[], index: number, context: InstructionContext): VoiceInstructions[] {
  const step = steps[index];
  const next = steps[index + 1];
  if (!next) return [];
  const distance = step.distance;
  const upcoming = upcomingPhrase(next, context);
  const final = imminentPhrase(next, context);
  const depart = index === 0 ? maneuverPhrase(step, context) : '';
  if (distance <= 60) {
    return [voice(distance + START_MARGIN_M, depart ? sentence(depart, `sau đó ${upcoming}`) : sentence(final))];
  }
  const result: VoiceInstructions[] = [];
  const startAt = distance + START_MARGIN_M;
  if (depart) {
    result.push(voice(startAt, distance > 250 ? sentence(depart, `đi tiếp ${spokenDistance(distance)}`) : sentence(depart, `sau đó ${upcoming}`)));
  } else if (distance > 400) {
    result.push(voice(startAt, sentence(`đi tiếp ${spokenDistance(distance)}`, `sau đó ${upcoming}`)));
  } else if (distance > 120 && distance <= 300) {
    result.push(voice(startAt, sentence(`sau ${spokenDistance(distance)}`, upcoming)));
  }
  if (distance > 300) result.push(voice(200, sentence('sau 200 mét', upcoming)));
  result.push(voice(Math.min(50, distance), sentence(final)));
  return result;
}

function summary(steps: RouteStep[]): string {
  const names: string[] = [];
  for (const step of [...steps].sort((a, b) => b.distance - a.distance)) {
    const name = step.name.trim();
    if (name && !names.includes(name)) names.push(name);
    if (names.length === 2) break;
  }
  return names.join(', ');
}

export interface DirectionsRouteOptions extends InstructionContext {
  origin: LngLat;
  destination: LngLat;
}

export function toDirectionsRoute(route: PlannedRoute, options: DirectionsRouteOptions): Record<string, unknown> {
  const { steps } = route;
  if (steps.length < 2 || steps[steps.length - 1].maneuver.type !== 'arrive') throw new Error('INVALID_ROUTE_STEPS');
  const legSteps = steps.map((step, index) => ({
    geometry: encodePolyline(step.geometry.length >= 2 ? step.geometry : [step.maneuver.location, step.maneuver.location]),
    distance: round1(step.distance),
    duration: round1(step.duration),
    weight: round1(step.duration),
    name: step.name,
    mode: 'driving',
    driving_side: 'right',
    maneuver: {
      location: step.maneuver.location,
      bearing_before: Math.round(step.maneuver.bearingBefore),
      bearing_after: Math.round(step.maneuver.bearingAfter),
      instruction: capitalize(maneuverPhrase(step, options)),
      type: step.maneuver.type,
      ...(step.maneuver.modifier ? { modifier: step.maneuver.modifier } : {}),
      ...(step.maneuver.exit ? { exit: step.maneuver.exit } : {}),
    },
    intersections: (step.intersections.length ? step.intersections : [{ location: step.maneuver.location, bearings: [Math.round(step.maneuver.bearingAfter)], entry: [true], out: 0 }])
      .map((item) => ({
        location: item.location,
        bearings: item.bearings,
        entry: item.entry,
        ...(item.in === undefined ? {} : { in: item.in }),
        ...(item.out === undefined ? {} : { out: item.out }),
      })),
    voiceInstructions: voices(steps, index, options),
    bannerInstructions: banners(steps, index, options),
  }));
  const distance = round1(steps.reduce((total, step) => total + step.distance, 0));
  const duration = round1(steps.reduce((total, step) => total + step.duration, 0));
  return {
    geometry: encodePolyline(route.geometry),
    distance,
    duration,
    weight: duration,
    weight_name: 'routability',
    voiceLocale: 'vi',
    legs: [{ distance, duration, summary: summary(steps), steps: legSteps }],
    // Chỉ để SDK bật milestone, chọn giọng tiếng Việt và đánh dấu điểm đích. App tự tính lại tuyến khi lệch,
    // không để SDK gọi baseUrl này.
    routeOptions: {
      baseUrl: 'https://routing.chande.invalid',
      user: 'chande',
      profile: 'driving',
      coordinates: [options.origin, options.destination],
      alternatives: false,
      language: 'vi',
      geometries: 'polyline6',
      overview: 'full',
      steps: true,
      continue_straight: true,
      voice_instructions: true,
      banner_instructions: true,
      voice_units: 'metric',
    },
  };
}
