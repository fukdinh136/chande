import * as Location from 'expo-location';
import { currentLocation, setLocation, type Sample } from '../../map/location-store';
import { gpsLimits, GPS_SEND_INTERVAL_MS, sampleIssue, type GpsSample } from './location-policy';
import { SocketLocationClient, type GpsConnection, type GpsReceipt } from './socket-location-client';
import type { SessionManager } from '../session/session-manager';
import type { DriverSocket } from '../realtime/driver-socket';

let deviceFix: Promise<Location.LocationObject> | null = null;
function currentFix() {
  if (!deviceFix) {
    const job = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    deviceFix = job;
    const finish = () => { if (deviceFix === job) deviceFix = null; };
    void job.then(finish, finish);
  }
  return deviceFix;
}

export interface GpsState {
  requested: boolean; foreground: boolean; publishing: boolean;
  permission: 'unknown' | 'checking' | 'granted' | 'denied' | 'blocked';
  services: 'unknown' | 'enabled' | 'disabled'; watcher: 'paused' | 'starting' | 'active' | 'error';
  connection: GpsConnection; sending: boolean; sample: GpsSample | null;
  accepted: (GpsReceipt & { run: number }) | null; acceptedFresh: boolean;
  sampleAgeSeconds: number | null; acceptedAgeSeconds: number | null; issue: string | null; error: string | null;
}
// One instance per Driver runtime, activated by the authenticated shell. Map/navigation consume its
// location store; neither creates another device watcher or server publisher.
export class DriverGpsSession {
  readonly limits = gpsLimits();
  private state: GpsState = { requested: false, foreground: false, publishing: false, permission: 'unknown', services: 'unknown', watcher: 'paused', connection: 'paused', sending: false, sample: null, accepted: null, acceptedFresh: false, sampleAgeSeconds: null, acceptedAgeSeconds: null, issue: null, error: null };
  private listeners = new Set<() => void>();
  private run = 0;
  private control: AbortController | null = null;
  private watcher: Location.LocationSubscription | null = null;
  private client: SocketLocationClient | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private mapSample: Sample | null = null;
  private checking = false;
  private acquiring = false; // Expo one-shot cannot be aborted: never overlap it.
  private lastAcquisition = 0;
  private lastHealth = 0;
  private lastAttempt = 0;
  private attemptedTimestamp = -1;
  private hasRequestedPermission = false;
  private owner: number;
  private unsubscribeSession: () => void;
  constructor(private readonly session: SessionManager, private readonly base: string | null, private readonly connection: DriverSocket) {
    this.owner = session.getOwnerEpoch();
    this.unsubscribeSession = session.subscribe(() => {
      if (this.owner !== session.getOwnerEpoch()) {
        this.stop(); this.owner = session.getOwnerEpoch();
        this.hasRequestedPermission = false; this.lastAttempt = 0; this.attemptedTimestamp = -1;
        this.publish({ requested: false, sample: null, accepted: null, permission: 'unknown', services: 'unknown', error: null });
      } else if (!session.getSnapshot().usable && this.control) this.stop();
    });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<GpsState> = {}) {
    const now = Date.now(), state = { ...this.state, ...patch };
    state.issue = this.limits ? sampleIssue(state.sample, now, this.limits) : 'GPS_CONFIG_INVALID';
    state.sampleAgeSeconds = state.sample && Number.isFinite(state.sample.timestamp) ? Math.max(0, Math.floor((now - state.sample.timestamp) / 1000)) : null;
    const acceptedAge = state.accepted ? Math.max(0, now - Date.parse(state.accepted.recordedAt), now - Date.parse(state.accepted.receivedAt)) : null;
    state.acceptedAgeSeconds = acceptedAge === null ? null : Math.floor(acceptedAge / 1000);
    state.acceptedFresh = !!this.limits && !!state.accepted && state.accepted.run === this.run && acceptedAge !== null && acceptedAge < this.limits.freshnessMs &&
      Date.parse(state.accepted.recordedAt) <= now + this.limits.maxFutureMs && Date.parse(state.accepted.receivedAt) <= now + this.limits.maxFutureMs;
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  private current(run: number) { return run === this.run && this.owner === this.session.getOwnerEpoch() && this.session.getSnapshot().usable && this.state.requested && this.state.foreground && !!this.control && !this.control.signal.aborted; }
  private clearMap() {
    if (this.mapSample && currentLocation() === this.mapSample) setLocation(null);
    this.mapSample = null;
  }
  stop = () => {
    this.run++; this.control?.abort(); this.control = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null; this.client?.stop(); this.client = null;
    this.watcher?.remove(); this.watcher = null;
    this.clearMap();
    this.publish({ watcher: 'paused', connection: this.base ? 'paused' : 'unconfigured', sending: false });
  };
  configure(requested: boolean, foreground: boolean, publishing: boolean) {
    this.stop();
    this.publish({ requested, foreground, publishing, error: null });
    if (requested && foreground && this.session.getSnapshot().usable) void this.start(!this.hasRequestedPermission);
  }
  setRequested = (requested: boolean) => { if (!requested) this.stop(); this.publish({ requested }); };
  retry = () => { if (this.state.requested && this.state.foreground && this.session.getSnapshot().usable) { this.stop(); void this.start(true); } };
  private permissionState(value: Location.LocationPermissionResponse): GpsState['permission'] {
    return value.granted ? 'granted' : value.canAskAgain ? 'denied' : 'blocked';
  }
  private async start(ask: boolean) {
    if (!this.limits) { this.publish({ error: 'GPS_CONFIG_INVALID' }); return; }
    const run = this.run, controller = new AbortController();
    this.control = controller;
    this.lastHealth = Date.now();
    if (ask) this.hasRequestedPermission = true;
    this.publish({ permission: 'checking', services: 'unknown', watcher: 'starting', sample: null, error: null });
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (!this.current(run)) return;
      if (!permission.granted && ask && permission.canAskAgain) {
        this.hasRequestedPermission = true;
        permission = await Location.requestForegroundPermissionsAsync();
        if (!this.current(run)) return;
      }
      this.publish({ permission: this.permissionState(permission) });
      if (!permission.granted) { this.stop(); return; }
      const enabled = await Location.hasServicesEnabledAsync();
      if (!this.current(run)) return;
      this.publish({ services: enabled ? 'enabled' : 'disabled' });
      if (!enabled) { this.stop(); return; }
      const watcher = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0 },
        value => this.acceptSample(value, run), () => { if (this.current(run)) { this.stop(); this.publish({ watcher: 'error', error: 'LOCATION_ERROR' }); } });
      if (!this.current(run)) { watcher.remove(); return; }
      this.watcher = watcher;
      this.publish({ watcher: 'active' });
      if (this.base && this.state.publishing) {
        const client = new SocketLocationClient(this.connection,
          (connection, code) => { if (this.current(run)) this.publish({ connection, error: code ?? null }); },
          () => { if (this.current(run)) void this.send(run); });
        this.client = client; client.start();
      }
      this.timer = setInterval(() => this.tick(run), 1000);
      if (!this.acquiring) void this.acquire(run);
      this.tick(run);
    } catch { if (this.current(run)) { this.stop(); this.publish({ watcher: 'error', error: 'LOCATION_ERROR' }); } }
  }
  private acceptSample(value: Location.LocationObject, run: number) {
    if (!this.current(run)) return;
    // A delayed one-shot must not replace a newer watcher measurement.
    if (this.state.sample && Number.isFinite(this.state.sample.timestamp) && this.state.sample.timestamp <= Date.now() + (this.limits?.maxFutureMs ?? 0) && value.timestamp <= this.state.sample.timestamp) return;
    const coords = value.coords;
    const sample: GpsSample = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, timestamp: value.timestamp,
      speed: Number.isFinite(coords.speed) && coords.speed !== null ? coords.speed : -1,
      heading: Number.isFinite(coords.heading) && coords.heading !== null ? coords.heading : -1 };
    this.publish({ sample, error: this.state.error === 'LOCATION_ERROR' ? null : this.state.error });
    const issue = this.state.issue;
    if (!issue || issue === 'LOW_ACCURACY') {
      if (sample.accuracy !== null && Number.isFinite(sample.accuracy) && sample.accuracy >= 0) {
        this.mapSample = { ...sample, accuracy: sample.accuracy };
        setLocation(this.mapSample);
        return;
      }
    }
    this.clearMap();
  }
  private tick(run: number) {
    if (!this.current(run)) return;
    const now = Date.now();
    this.publish(); // Freshness ages even while stationary or waiting for an ACK.
    if (this.state.issue && this.state.issue !== 'LOW_ACCURACY') this.clearMap();
    if (now - this.lastHealth >= 5000 && !this.checking) void this.checkHealth(run);
    // iOS may not emit while stationary; obtain a real new measurement, never
    // rewrite the timestamp of the last point. One one-shot at a time.
    if ((!this.state.sample || ['INVALID_LOCATION', 'LOCATION_IN_FUTURE'].includes(this.state.issue ?? '') || now - this.state.sample.timestamp >= GPS_SEND_INTERVAL_MS) && now - this.lastAcquisition >= GPS_SEND_INTERVAL_MS && !this.acquiring) void this.acquire(run);
    void this.send(run);
  }
  private async checkHealth(run: number) {
    this.checking = true; this.lastHealth = Date.now();
    try {
      const [permission, enabled] = await Promise.all([Location.getForegroundPermissionsAsync(), Location.hasServicesEnabledAsync()]);
      if (!this.current(run)) return;
      this.publish({ permission: this.permissionState(permission), services: enabled ? 'enabled' : 'disabled' });
      if (!permission.granted || !enabled) this.stop();
    } catch { if (this.current(run)) { this.stop(); this.publish({ watcher: 'error', error: 'LOCATION_ERROR' }); } }
    finally { this.checking = false; }
  }
  private async acquire(run: number) {
    this.acquiring = true; this.lastAcquisition = Date.now();
    try { this.acceptSample(await currentFix(), run); }
    catch { if (this.current(run)) this.publish({ error: 'LOCATION_ERROR' }); }
    finally { this.acquiring = false; }
  }
  private async send(run: number) {
    const sample = this.state.sample, now = Date.now(), client = this.client;
    if (!this.current(run) || !client || !this.limits || !this.state.publishing || this.state.watcher !== 'active' || this.state.permission !== 'granted' || this.state.services !== 'enabled' ||
      this.state.connection !== 'connected' || this.state.sending || sampleIssue(sample, now, this.limits) || !sample || sample.timestamp <= this.attemptedTimestamp || now - this.lastAttempt < GPS_SEND_INTERVAL_MS) return;
    this.lastAttempt = now; this.attemptedTimestamp = sample.timestamp;
    this.publish({ sending: true, error: null });
    try {
      const receipt = await client.send({ latitude: sample.lat, longitude: sample.lng, accuracy: sample.accuracy!, recordedAt: new Date(sample.timestamp).toISOString() });
      if (this.current(run)) this.publish({ accepted: { ...receipt, run } });
    } catch (error) {
      if (this.current(run)) {
        const code = error instanceof Error ? error.message : 'GPS_DISCONNECTED';
        if (code === 'UNAUTHENTICATED') { client.stop(); this.publish({ connection: 'auth-error', error: code }); }
        else this.publish({ error: code });
      }
    } finally { if (this.current(run)) this.publish({ sending: false }); }
  }
  dispose() { this.unsubscribeSession(); this.stop(); this.listeners.clear(); }
}
