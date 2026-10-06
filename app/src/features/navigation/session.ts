import ChandeNavigation, { type NavigationEndReason, type NavigationProgressEvent } from '../../../modules/chande-navigation';
import { toDirectionsRoute } from './directions';
import type { LngLat } from './geo';
import type { PlannedRoute } from './model';
import type { RouteProvider } from './providers';

/** Có MapLibre Navigation SDK native (Android development build). */
export const nativeNavigationAvailable = ChandeNavigation !== null;

export interface NavigationTarget {
  location: LngLat;
  /** Dùng trong câu chỉ dẫn, ví dụ "điểm đón". */
  label: string;
  vehicleType: string;
}

export type NavigationSessionEvent =
  | { type: 'running' }
  | ({ type: 'progress' } & NavigationProgressEvent)
  | { type: 'rerouting' }
  | { type: 'rerouted'; route: PlannedRoute }
  | { type: 'rerouteFailed'; error: unknown }
  | { type: 'arrival' }
  | { type: 'ended'; reason: NavigationEndReason; message: string | null };

export function navigationRouteJson(route: PlannedRoute, origin: LngLat, target: NavigationTarget): string {
  return JSON.stringify(toDirectionsRoute(route, { destinationLabel: target.label, origin, destination: target.location }));
}

/**
 * Một lần dẫn đường bằng SDK native. Khi SDK báo lệch tuyến, gọi routing-service R04 (hoặc OSRM khi phát triển)
 * từ vị trí hiện tại rồi đẩy tuyến mới vào SDK; mỗi lúc chỉ một yêu cầu tính lại.
 */
export class NativeNavigationSession {
  private subscriptions: { remove(): void }[] = [];
  private rerouting = false;
  private arrived = false;

  constructor(
    private readonly provider: RouteProvider,
    private readonly target: NavigationTarget,
    private readonly listener: (event: NavigationSessionEvent) => void,
  ) {}

  async start(route: PlannedRoute, origin: LngLat, simulate: boolean) {
    const native = ChandeNavigation;
    if (!native) throw new Error('NATIVE_NAVIGATION_UNAVAILABLE');
    this.dispose();
    this.subscriptions = [
      native.addListener('onRunning', () => this.listener({ type: 'running' })),
      native.addListener('onProgress', (event) => this.listener({ type: 'progress', ...event })),
      native.addListener('onOffRoute', (event) => { void this.reroute([event.longitude, event.latitude]); }),
      native.addListener('onArrival', () => {
        this.arrived = true;
        this.listener({ type: 'arrival' });
      }),
      native.addListener('onEnded', (event) => {
        this.listener({ type: 'ended', reason: event.reason, message: event.message });
        this.dispose();
      }),
    ];
    try {
      await native.start({ routeJson: navigationRouteJson(route, origin, this.target), simulate });
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  private async reroute(origin: LngLat) {
    const native = ChandeNavigation;
    if (!native || this.rerouting || this.arrived) return;
    this.rerouting = true;
    this.listener({ type: 'rerouting' });
    try {
      const route = await this.provider.route({ origin, destination: this.target.location, vehicleType: this.target.vehicleType, reroute: true });
      if (await native.updateRoute(navigationRouteJson(route, origin, this.target))) this.listener({ type: 'rerouted', route });
    } catch (error) {
      this.listener({ type: 'rerouteFailed', error });
    } finally {
      this.rerouting = false;
    }
  }

  async stop() {
    await ChandeNavigation?.stop();
  }

  dispose() {
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions = [];
  }
}
