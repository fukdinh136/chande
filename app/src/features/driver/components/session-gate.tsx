import { Redirect, Slot } from 'expo-router';
import { useDriverSession } from '../state/driver-provider';
import { Busy, Screen } from './ui';

export function SessionGate() {
  const state = useDriverSession();
  if (state.restoring) return <Screen title="Khôi phục phiên"><Busy visible /></Screen>;
  if (!state.session) return <Redirect href="/driver/login" />;
  return <Slot />;
}
