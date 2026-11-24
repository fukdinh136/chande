import { Stack } from 'expo-router';
import { DriverProvider } from '@/features/driver/state/driver-provider';

export default function DriverLayout() {
  return <DriverProvider>
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="(authenticated)" options={{ headerShown: false }} />
    </Stack>
  </DriverProvider>;
}
