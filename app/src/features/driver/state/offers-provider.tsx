import { useEffect, useSyncExternalStore, type PropsWithChildren } from 'react';
import { Modal, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useDriverRuntime, useDriverSession } from './driver-provider';
import { useDriverResources } from './session-resources';
import { useDriverForeground } from '../hooks/use-driver-foreground';
import type { OfferState } from './offer-coordinator';
import { OffersScreen } from '../screens/offers-screen';
import { OffersContext, type Offers } from './offers-context';
export { useOffers } from './offers-context';

export function OffersProvider({ children }: PropsWithChildren) {
  const runtime = useDriverRuntime(), { session } = useDriverSession(), path = usePathname();
  const { active } = useDriverResources(), foreground = useDriverForeground();
  const coordinator = runtime.offers, driverId = session!.driver.driverId, refreshActive = active.refresh;
  const ownerEpoch = runtime.session.getOwnerEpoch();
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot);
  useEffect(() => {
    coordinator.start(driverId, refreshActive);
    return () => coordinator.stop();
  }, [coordinator, driverId, ownerEpoch, refreshActive]);
  useEffect(() => { coordinator.setForeground(foreground); }, [coordinator, driverId, ownerEpoch, foreground]);
  useEffect(() => { coordinator.observeActive(active); }, [coordinator, ownerEpoch, active]);
  useEffect(() => runtime.realtime.subscribe(notice => {
    if (notice.kind === 'offer-invalidated' || notice.kind === 'reconnected') coordinator.refresh();
  }), [runtime.realtime, coordinator]);
  const visibleState: OfferState = state.driverId === driverId ? state : { ...state, data: undefined, ready: false, phase: 'restoring', canDecide: false, canAccept: false, canRetry: false, error: null, commandError: null, storageError: null, legacy: false };
  const value: Offers = { ...visibleState, refresh: coordinator.refresh, refreshAll: coordinator.refreshAll, decide: coordinator.decide, retry: coordinator.retry };
  const popup = state.driverId === driverId && state.phase === 'available' && state.remaining > 0 && !path.includes('/offers');
  return <OffersContext.Provider value={value}>{children}
    <Modal transparent visible={popup} animationType="slide" onRequestClose={() => router.push('/driver/offers')}>
      <View style={{ flex: 1, backgroundColor: '#0b1c3070', justifyContent: 'flex-end' }}>
        <View style={{ height: '90%', borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' }}><OffersScreen modal /></View>
      </View>
    </Modal>
  </OffersContext.Provider>;
}
