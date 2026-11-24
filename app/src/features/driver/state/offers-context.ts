import { createContext, useContext } from 'react';
import type { OfferCoordinator, OfferState } from './offer-coordinator';

export type Offers = OfferState & Pick<OfferCoordinator, 'refreshAll' | 'decide' | 'retry'> & { refresh: () => void };
// Shared by the provider and its modal/screen consumers. This module must not
// import UI or create a coordinator; the authenticated session owns that state.
export const OffersContext = createContext<Offers | null>(null);

export function useOffers() {
  const value = useContext(OffersContext);
  if (!value) throw new Error('OffersProvider required');
  return value;
}
