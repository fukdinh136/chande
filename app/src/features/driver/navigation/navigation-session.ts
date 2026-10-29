import { Platform } from 'react-native';
import { Navigation, type Progress } from '../../navigation/native';
import { currentLocation, subscribeLocation, type Sample } from '../../map/location-store';
import type { Trip } from '../contracts/models';
import type { DriverRuntime } from '../state/runtime';
import { ApiError, errorText } from '../http/errors';
import { gpsLimits, gpsExplanation, sampleIssue } from '../gps/location-policy';
import { navigationRoute } from './route';

export type NavigationStage = 'paused' | 'waiting-gps' | 'loading' | 'preview' | 'navigating' | 'error' | 'unconfigured';
interface NavigationState {
  scope: string; stage: NavigationStage; line: [number, number][] | undefined; progress: Progress | null;
  message: string; error: string | null; distanceMeters: number | null; durationSeconds: number | null;
}
export type NavigationTrip = Pick<Trip, 'tripId' | 'status' | 'vehicleType' | 'pickup' | 'destination'>;
export const navigationPhase = (trip: NavigationTrip) => trip.status === 'ASSIGNED' ? 'pickup' : trip.status === 'IN_PROGRESS' ? 'dropoff' : null;
export const navigationScope = (trip: NavigationTrip) => `${trip.tripId}/${navigationPhase(trip)}/${trip.vehicleType}/${trip.pickup.lat},${trip.pickup.lng}/${trip.destination.lat},${trip.destination.lng}`;
let sequence = 0;
let nativeOwner: DriverNavigationSession | null = null;
// Screen-owned lifecycle; one native SDK owner, no location watcher/publisher.
export class DriverNavigationSession {
  readonly nativeSupported = Platform.OS === 'android' && !!Navigation;
  private readonly limits = gpsLimits();
  private state: NavigationState = { scope: '', stage: 'paused', line: undefined, progress: null, message: '', error: null, distanceMeters: null, durationSeconds: null };
  private listeners = new Set<() => void>();
  private run = 0;
  private owner = -1;
  private trip: NavigationTrip | null = null;
  private request: AbortController | null = null;
  private unsubscribeLocation: (() => void) | null = null;
  private unsubscribeSession: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private rerouteTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRequest = 0;
  private nativeSession = '';
  private nativeTimestamp = -1;
  private nativeListeners: { remove(): void }[] = [];
  constructor(private readonly runtime: DriverRuntime) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<NavigationState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  private current(run: number) { return run === this.run && !!this.trip && this.owner === this.runtime.session.getOwnerEpoch() && this.runtime.session.getSnapshot().usable; }
  private issue(sample: Sample | null) {
    return this.limits ? sampleIssue(sample, Date.now(), { ...this.limits, maxAccuracyMeters: Math.min(100, this.limits.maxAccuracyMeters) }) : 'GPS_CONFIG_INVALID';
  }
  private stopNative() {
    this.nativeSession = '';
    this.nativeTimestamp = -1;
    for (const listener of this.nativeListeners) { try { listener.remove(); } catch { /* Continue cleaning the other native listeners. */ } }
    this.nativeListeners = [];
    if (nativeOwner === this) {
      nativeOwner = null;
      try { Navigation?.stop(); } catch { /* The old session is invalidated in JS regardless. */ }
    }
  }
  private clearRoute() {
    this.request?.abort(); this.request = null;
    if (this.rerouteTimer) clearTimeout(this.rerouteTimer);
    this.rerouteTimer = null;
    this.stopNative();
    this.publish({ line: undefined, progress: null, distanceMeters: null, durationSeconds: null, error: null });
  }
  stop = () => {
    this.run++; this.trip = null;
    this.unsubscribeLocation?.(); this.unsubscribeLocation = null;
    this.unsubscribeSession?.(); this.unsubscribeSession = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.clearRoute(); this.publish({ stage: 'paused', message: 'Điều hướng đã tạm dừng.' });
  };
  start(trip: NavigationTrip) {
    this.stop();
    this.owner = this.runtime.session.getOwnerEpoch(); this.trip = trip;
    const run = this.run;
    this.publish({ scope: navigationScope(trip), stage: 'waiting-gps', message: 'Bật GPS và chờ vị trí mới, chính xác để lấy tuyến.' });
    if (!navigationPhase(trip)) { this.stop(); return; }
    if (!this.runtime.capabilities.routing.configured) { this.publish({ stage: 'unconfigured', message: this.runtime.capabilities.routing.reason }); return; }
    this.unsubscribeSession = this.runtime.session.subscribe(() => { if (!this.current(run)) this.stop(); });
    this.unsubscribeLocation = subscribeLocation(() => this.locationChanged(run));
    this.timer = setInterval(() => this.locationChanged(run), 1000);
    this.locationChanged(run);
  }
  private locationChanged(run: number) {
    if (!this.current(run)) return;
    const sample = currentLocation(), issue = this.issue(sample);
    if (issue) {
      if (this.state.stage !== 'waiting-gps') this.clearRoute();
      this.publish({ stage: 'waiting-gps', message: gpsExplanation[issue] ?? 'Cấu hình hoặc mẫu GPS chưa hợp lệ.' });
      return;
    }
    if (this.state.stage === 'waiting-gps') { void this.fetchRoute(run); return; }
    if (this.nativeSession && nativeOwner === this && sample && sample.timestamp > this.nativeTimestamp) {
      try { this.nativeTimestamp = sample.timestamp; Navigation!.pushLocation(sample.lat, sample.lng, sample.accuracy, sample.timestamp, sample.speed, sample.heading); }
      catch { this.stopNative(); this.publish({ stage: 'preview', progress: null, message: 'Chỉ hiển thị tuyến preview: native navigation chưa hoạt động trong bản cài này.' }); }
    }
  }
  retry = () => { if (this.current(this.run) && !this.request && !this.rerouteTimer) void this.fetchRoute(this.run); };
  private reroute(run: number, sessionId: string) {
    if (!this.current(run) || this.nativeSession !== sessionId || this.rerouteTimer) return;
    this.clearRoute();
    this.publish({ stage: 'loading', message: 'Đã lệch tuyến; đang lấy tuyến mới.' });
    this.rerouteTimer = setTimeout(() => { this.rerouteTimer = null; if (this.current(run)) void this.fetchRoute(run); }, Math.max(0, 5000 - (Date.now() - this.lastRequest)));
  }
  private async fetchRoute(run: number) {
    if (!this.current(run) || this.request || !this.trip || !this.runtime.capabilities.routing.configured) return;
    const trip = this.trip, sample = currentLocation(), issue = this.issue(sample);
    if (issue || !sample) { this.clearRoute(); this.publish({ stage: 'waiting-gps', message: gpsExplanation[issue ?? 'GPS_SEARCHING'] ?? 'Chưa có GPS hợp lệ.' }); return; }
    this.clearRoute();
    const delay = 5000 - (Date.now() - this.lastRequest);
    if (delay > 0) {
      this.publish({ stage: 'loading', message: 'Đang chờ lấy tuyến mới.' });
      if (!this.rerouteTimer) this.rerouteTimer = setTimeout(() => { this.rerouteTimer = null; if (this.current(run)) void this.fetchRoute(run); }, delay);
      return;
    }
    const control = new AbortController(); this.request = control; this.lastRequest = Date.now();
    const scope = navigationScope(trip), target = navigationPhase(trip) === 'dropoff' ? trip.destination : trip.pickup;
    this.publish({ stage: 'loading', message: 'Đang lấy tuyến mới từ Routing.' });
    try {
      const result = await this.runtime.navigation.navigation(sample, target, trip.vehicleType, control.signal);
      if (!this.current(run) || control.signal.aborted || this.request !== control || this.state.scope !== scope) return;
      const latest = currentLocation(), latestIssue = this.issue(latest);
      if (latestIssue || !latest) { this.clearRoute(); this.publish({ stage: 'waiting-gps', message: gpsExplanation[latestIssue ?? 'GPS_SEARCHING'] ?? 'GPS không còn hợp lệ.' }); return; }
      const route = navigationRoute(result.data, trip.vehicleType);
      // Preview is committed independently of native SDK support/start failure.
      this.publish({ stage: 'preview', line: route.line, progress: null, distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds,
        message: 'Chỉ hiển thị tuyến preview. Bản cài/thiết bị này chưa hỗ trợ chỉ dẫn native.' });
      if (this.nativeSupported) {
        try {
          nativeOwner?.stopNative(); nativeOwner = this;
          const sessionId = `${this.owner}/${scope}/${++sequence}`; this.nativeSession = sessionId;
          this.nativeListeners.push(Navigation!.addListener('progress', progress => {
              if (!this.current(run) || nativeOwner !== this || this.nativeSession !== sessionId || progress.sessionId !== sessionId || this.issue(currentLocation())) return;
              if ([progress.remainingDistanceMeters, progress.remainingDurationSeconds, progress.distanceToManeuverMeters].every(value => Number.isFinite(value) && value >= 0)) this.publish({ progress });
            }));
          this.nativeListeners.push(Navigation!.addListener('offRoute', event => { if (event.sessionId === sessionId && nativeOwner === this) this.reroute(run, sessionId); }));
          // Replace the injected engine's replay point BEFORE starting a new SDK
          // session; its previous-trip cache must never seed this route.
          this.nativeTimestamp = latest.timestamp;
          Navigation!.pushLocation(latest.lat, latest.lng, latest.accuracy, latest.timestamp, latest.speed, latest.heading);
          if (Navigation!.start(JSON.stringify(route.route), sessionId) !== true) throw new Error('NATIVE_START_FAILED');
          if (this.nativeSession === sessionId) this.publish({ stage: 'navigating', message: 'Đang chạy chỉ dẫn native.' });
        } catch {
          this.stopNative();
          this.publish({ stage: 'preview', progress: null, message: 'Tuyến preview đã sẵn sàng. Native navigation chưa khởi tạo được; cần kiểm tra development build.' });
        }
      }
    } catch (error) {
      if (this.current(run) && !control.signal.aborted && this.request === control) {
        this.clearRoute();
        this.publish({ stage: 'error', error: error instanceof ApiError ? errorText(error) : 'Tuyến trả về chưa hợp lệ. Hãy thử lại hoặc kiểm tra Routing.', message: 'Chưa lấy được tuyến hiện tại.' });
      }
    } finally { if (this.request === control) this.request = null; }
  }
}
