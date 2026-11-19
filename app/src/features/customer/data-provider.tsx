import {createContext, useContext, useLayoutEffect, useState, useSyncExternalStore, type PropsWithChildren} from 'react';
import {CustomerDataStore} from './data-store';
import {useCustomer} from './provider';

const Context = createContext<CustomerDataStore | null>(null);
export function CustomerDataProvider({children}: PropsWithChildren) {
  const runtime = useCustomer();
  const [store] = useState(() => new CustomerDataStore(runtime));
  useLayoutEffect(() => store.start(), [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useCustomerData() {
  const store = useContext(Context);
  if (!store) throw new Error('CustomerDataProvider required');
  return {data: store, places: useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)};
}
