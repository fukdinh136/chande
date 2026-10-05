import { AuthClient } from '../clients/auth-client';
import { DriverClient } from '../clients/driver-client';
import { TripClient } from '../clients/trip-client';
import { UnconfiguredMatchingClient } from '../clients/matching-client';
import { loadHttpConfig } from '../http/config';
import { FetchTransport } from '../http/transport';
import { UnconfiguredRealtimeClient } from '../realtime/realtime-client';
import { SessionManager } from '../session/session-manager';
import { DriverStorage } from '../session/storage';
import { TripCommandManager } from './trip-command-manager';

export function createDriverRuntime() {
  const config = loadHttpConfig();
  const http = new FetchTransport(config);
  const auth = new AuthClient(http, config);
  const storage = new DriverStorage(`${config.mode}|${config.driverBase}|${config.gatewayPrefix}|${config.tripBase ?? ''}`);
  const session = new SessionManager(auth, http, storage);
  const trip = new TripClient(session, config);
  return {
    config, auth, storage, session,
    driver: new DriverClient(session, config), trip,
    commands: new TripCommandManager(trip, session, storage),
    matching: new UnconfiguredMatchingClient(), realtime: new UnconfiguredRealtimeClient(),
  };
}
export type DriverRuntime = ReturnType<typeof createDriverRuntime>;
