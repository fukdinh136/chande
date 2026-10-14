import type { HttpConfig } from '../http/config';
import type { SessionManager } from '../session/session-manager';
import type { Point } from '../../backend/clients';

// Direct Routing requires an internal credential. Mobile uses the public Gateway.
export class DriverNavigationClient {
  constructor(private readonly config: HttpConfig, private readonly session: SessionManager) {}
  navigation(origin: Point, destination: Point, vehicleType: string, signal?: AbortSignal) {
    return this.session.request({ service: 'routing', path: `${this.config.routingPrefix}/routes/navigation`, method: 'POST',
      body: { origin: { lat: origin.lat, lng: origin.lng }, destination: { lat: destination.lat, lng: destination.lng }, vehicleType }, signal });
  }
}
