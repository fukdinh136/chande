import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { AppState, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, BrandMark, Txt, colors, space } from '@/design';
import { createRouteProvider } from '../navigation/providers';
import { AccountStore } from './account-store';
import { BookingStore } from './booking';
import { TripClient, UserClient } from './clients';
import { loadRiderConfig } from './config';
import { errorText } from './errors';
import { Geocoder } from './geocoder';
import { RiderHttp } from './http';
import { TripRealtime } from './realtime';
import { RiderSession } from './session';
import { RiderStorage } from './storage';
import { useStore } from './store';
import { TripStore } from './trip-store';

export function createRiderRuntime() {
  const config = loadRiderConfig();
  const http = new RiderHttp(config);
  const session = new RiderSession(http, new RiderStorage(config.apiBase));
  const users = new UserClient(session);
  const trips = new TripClient(session);
  const routes = createRouteProvider(() => session.accessToken().catch(() => null));
  return {
    config, session, users, trips, routes,
    booking: new BookingStore(trips, routes, config.vehicleTypes),
    trip: new TripStore(trips),
    account: new AccountStore(users),
    realtime: new TripRealtime(config.wsUrl, () => session.accessToken()),
    geocoder: config.geocoderUrl ? new Geocoder(config.geocoderUrl, config.timeoutMs) : null,
  };
}
export type RiderRuntime = ReturnType<typeof createRiderRuntime>;

const Context = createContext<RiderRuntime | null>(null);

export function RiderProvider({ children }: PropsWithChildren) {
  const [initial] = useState(() => {
    try { return { runtime: createRiderRuntime(), error: null as unknown }; } catch (error) { return { runtime: null, error }; }
  });
  useEffect(() => {
    if (initial.runtime) void initial.runtime.session.restore();
  }, [initial]);
  if (!initial.runtime) return <ConfigurationScreen error={initial.error} />;
  return (
    <Context.Provider value={initial.runtime}>
      <SessionEffects />
      {children}
    </Context.Provider>
  );
}

function SessionEffects() {
  const runtime = useRider();
  const session = useRiderSession();
  const signedIn = session.status === 'signedIn';
  useEffect(() => {
    if (!signedIn) {
      runtime.booking.reset();
      runtime.trip.reset();
      runtime.account.reset();
      return;
    }
    void runtime.trip.refresh();
    void runtime.account.refreshProfile();
    const offEvent = runtime.realtime.onEvent((event) => runtime.trip.apply(event));
    const offConnected = runtime.realtime.onConnected(() => { void runtime.trip.refresh(); });
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') void runtime.trip.refresh(); });
    runtime.realtime.start();
    return () => {
      offEvent();
      offConnected();
      appState.remove();
      runtime.realtime.stop();
    };
  }, [runtime, signedIn, session.userId]);
  return null;
}

function ConfigurationScreen({ error }: { error: unknown }) {
  return (
    <SafeAreaView style={styles.config}>
      <ScrollView contentContainerStyle={styles.configBody}>
        <BrandMark size={48} />
        <Txt variant="headline-md">Chưa cấu hình app khách</Txt>
        <Banner tone="error" message={errorText(error)} />
        <Txt variant="body-md" color={colors.onSurfaceVariant}>
          Sao chép rider.env.example thành .env.local trong thư mục app, điền địa chỉ API Gateway rồi khởi động lại Expo.
        </Txt>
      </ScrollView>
    </SafeAreaView>
  );
}

export function useRider(): RiderRuntime {
  const runtime = useContext(Context);
  if (!runtime) throw new Error('RiderProvider required');
  return runtime;
}

export function useRiderSession() {
  const { session } = useRider();
  return useStore(session);
}

const styles = StyleSheet.create({
  config: { flex: 1, backgroundColor: colors.surface },
  configBody: { padding: space.lg, gap: space.md },
});
