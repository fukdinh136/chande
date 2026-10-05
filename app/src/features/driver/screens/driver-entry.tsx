import { Redirect } from 'expo-router';
import { useDriverSession } from '../state/driver-provider';
import { Busy, Screen } from '../components/ui';
import { OverviewScreen } from './overview-screen';

export function DriverEntry() {
  const session = useDriverSession();
  if (session.restoring) return <Screen title="Khôi phục phiên"><Busy visible /></Screen>;
  if (!session.session) return <Redirect href="/driver/login" />;
  return <OverviewScreen />;
}
