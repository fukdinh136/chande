import {createContext, useContext, useEffect, useState, useSyncExternalStore, type PropsWithChildren} from 'react';
import {Redirect} from 'expo-router';
import {DurableCommand} from '../backend/durable-command';
import {commandStorage} from '../backend/command-storage';
import {Busy, Notice, Screen} from '../ui/components';
import {useForeground} from '../ui/use-foreground';
import {CustomerBookingStore} from './booking-store';
import {useCustomer, useCustomerSession} from './provider';
import {CustomerDataProvider} from './data-provider';

const Context = createContext<CustomerBookingStore | null>(null);
export function CustomerSessionGate({children}: PropsWithChildren) {
  const {session} = useCustomer(), state = useCustomerSession();
  if (state.restoring) return <Screen title="Khôi phục phiên"><Busy visible/><Notice>Đang khôi phục tài khoản của bạn…</Notice></Screen>;
  if (!state.session) return <Redirect href="/customer/login"/>;
  return <BookingProvider key={`${state.session.profile.id}/${session.getOwnerEpoch()}`} actorId={state.session.profile.id}>{children}</BookingProvider>;
}
function BookingProvider({actorId, children}: PropsWithChildren<{actorId: string}>) {
  const runtime = useCustomer(), foreground = useForeground();
  const [store] = useState(() => new CustomerBookingStore(runtime, new DurableCommand(commandStorage('customer', runtime.base, actorId))));
  useEffect(() => store.start(), [store]);
  useEffect(() => runtime.events.subscribe(() => {void store.invalidate();}), [runtime, store]);
  useEffect(() => {
    const update = () => store.setConnection(runtime.events.getConnectionSnapshot?.() ?? 'paused');
    update(); return runtime.events.subscribeConnection?.(update);
  }, [runtime, store]);
  useEffect(() => {
    store.setForeground(foreground);
    if (!foreground) return;
    void store.refresh();
    const timer = setInterval(() => {void store.refresh();}, 5000);
    return () => clearInterval(timer);
  }, [foreground, store]);
  return <Context.Provider value={store}><CustomerDataProvider>{children}</CustomerDataProvider></Context.Provider>;
}
export function useBooking() {
  const store = useContext(Context);
  if (!store) throw new Error('Customer booking provider required');
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const command = useSyncExternalStore(store.commands.subscribe, store.commands.getSnapshot, store.commands.getSnapshot);
  return {store, state, command, locked: store.draftLocked};
}
