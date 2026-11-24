import { AuthClient } from '../clients/auth-client';
import { DriverClient } from '../clients/driver-client';
import { TripClient } from '../clients/trip-client';
import { DriverMatchingClient } from '../clients/matching-client';
import { DriverNavigationClient } from '../clients/navigation-client';
import { driverGatewayOrigin, driverHttpMode, gatewayContractConfirmed, loadHttpConfig, type HttpConfig } from '../http/config';
import { discover } from '../../backend/discovery';
import { Platform } from 'react-native';
import { FetchTransport } from '../http/transport';
import {GatewayRealtimeClient} from '../realtime/gateway-realtime-client';
import {gatewayOrigin} from '../../backend/connection';
import { SessionManager } from '../session/session-manager';
import { DriverStorage } from '../session/storage';
import { TripCommandManager } from './trip-command-manager';
import { OfferCoordinator } from './offer-coordinator';
import { DriverLoginManager } from '../session/login-manager';
import {BackendError} from '../../backend/http';
import {ApiError} from '../http/errors';
import { DriverGpsSession } from '../gps/gps-session';
import { DriverSocket } from '../realtime/driver-socket';
import { route } from '../http/routes';

export function createDriverRuntime(connectedConfig?: HttpConfig) {
  const config = connectedConfig ?? loadHttpConfig();
  const http = new FetchTransport(config);
  const auth = new AuthClient(http, config);
  const credentialScope = `${config.mode}|${config.driverBase}|${config.mode === 'gateway' ? config.gatewayPrefix : ''}|${config.tripBase ?? ''}`;
  const sampleId = '00000000-0000-4000-8000-000000000000', prefix = config.mode === 'gateway' ? config.gatewayPrefix : '';
  const verifyPath = route(config, 'otpVerify').path;
  let statusPath: string | null = null, cancelPath: string | null = null;
  // Invalid optional Trip overrides must not block Driver authentication. The
  // central route adapter still rejects them before any command is sent.
  try { statusPath = route(config, 'status', sampleId).path; cancelPath = route(config, 'cancel', sampleId).path; } catch { /* Keep a separate, non-replayable scope. */ }
  const tripScope = JSON.stringify([credentialScope, verifyPath, statusPath, cancelPath]);
  const legacyCommandsSafe = verifyPath === `${prefix}/driver-auth/otp/verify` && statusPath === `${prefix}/trips/${sampleId}/status` && cancelPath === `${prefix}/trips/${sampleId}/cancel`;
  const storage = new DriverStorage(credentialScope, tripScope, legacyCommandsSafe);
  const session = new SessionManager(auth, http, storage);
  const socket = new DriverSocket(config.realtimeBase, session);
  const gps = new DriverGpsSession(session, config.realtimeBase, socket);
  const trip = new TripClient(session, config);
  const matching = new DriverMatchingClient(config, session);
  const offers = new OfferCoordinator(matching, session, storage, config);
  const login = new DriverLoginManager(auth, session);
  const realtime = new GatewayRealtimeClient(config, session, socket);
  const commands = new TripCommandManager(trip, session, storage);
  return {
    config, auth, storage, session,
    driver: new DriverClient(session, config), trip,
    commands,
    capabilities: config.capabilities,
    matching, offers, login, gps,
    navigation: new DriverNavigationClient(config, session),
    realtime,
    dispose() { gps.dispose(); login.dispose(); offers.stop(); realtime.dispose(); socket.dispose(); commands.dispose(); session.dispose(); trip.clear(); },
  };
}
export async function connectDriverRuntime(signal: AbortSignal) {
  // Driver direct mode is independent of Customer's saved Gateway.
  if (driverHttpMode() === 'direct' || !gatewayContractConfirmed()) return createDriverRuntime();
  const explicit = driverGatewayOrigin() || await gatewayOrigin();
  if (explicit) return createDriverRuntime(loadHttpConfig(explicit));
  let base: string;
  try { base = await discover({ development:__DEV__||process.env.EXPO_PUBLIC_LOCAL_DEMO==='true', platform:Platform.OS==='android'?'android':Platform.OS==='ios'?'ios':'web', signal }); }
  catch (error) { if(error instanceof BackendError)throw new ApiError(error.code,error.status,error.requestId);throw error; }
  return createDriverRuntime(loadHttpConfig(base));
}
export type DriverRuntime = ReturnType<typeof createDriverRuntime>;
