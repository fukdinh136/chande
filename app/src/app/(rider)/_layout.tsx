import { Stack } from 'expo-router';
import { RiderProvider } from '@/features/rider/provider';

export default function RiderLayout() {
  return (
    <RiderProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </RiderProvider>
  );
}
