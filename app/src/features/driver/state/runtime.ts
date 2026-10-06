import { AuthClient } from '../clients/auth-client';
import { DriverClient } from '../clients/driver-client';
import { TripClient } from '../clients/trip-client';
import { GatewayMatchingClient, UnconfiguredMatchingClient } from '../clients/matching-client';
import { loadHttpConfig, type HttpConfig } from '../http/config';
import { discover } from '../../backend/discovery';
import { Platform } from 'react-native';
import { FetchTransport } from '../http/transport';
import { UnconfiguredRealtimeClient } from '../realtime/realtime-client';
import {GatewayRealtimeClient} from '../realtime/gateway-realtime-client';
import { SessionManager } from '../session/session-manager';
import { DriverStorage } from '../session/storage';
import { TripCommandManager } from './trip-command-manager';

export function createDriverRuntime(connectedConfig?: HttpConfig) {
  const config = connectedConfig ?? loadHttpConfig();
  const http = new FetchTransport(config);
  const auth = new AuthClient(http, config);
  const storage = new DriverStorage(`${config.mode}|${config.driverBase}|${config.gatewayPrefix}|${config.tripBase ?? ''}`);
  const session = new SessionManager(auth, http, storage);
  const trip = new TripClient(session, config);
  return {
    config, auth, storage, session,
    driver: new DriverClient(session, config), trip,
    commands: new TripCommandManager(trip, session, storage),
    matching: config.gatewayBase ? new GatewayMatchingClient(config.gatewayBase,session) : new UnconfiguredMatchingClient(), realtime: config.gatewayBase?new GatewayRealtimeClient(config.gatewayBase,()=>session.accessToken()):new UnconfiguredRealtimeClient(),
  };
}
export async function connectDriverRuntime(signal: AbortSignal) {
  if (process.env.EXPO_PUBLIC_DRIVER_HTTP_MODE || process.env.EXPO_PUBLIC_DRIVER_BASE_URL) return createDriverRuntime();
  const base = await discover({ development:__DEV__, platform:Platform.OS==='android'?'android':'web', explicit:process.env.EXPO_PUBLIC_BACKEND_ORIGIN, signal });
  return createDriverRuntime({mode:'gateway',driverBase:base,tripBase:base,gatewayBase:base,gatewayPrefix:'/api/v1',timeoutMs:10000,pollIntervalMs:5000});
}
export type DriverRuntime = ReturnType<typeof createDriverRuntime>;
