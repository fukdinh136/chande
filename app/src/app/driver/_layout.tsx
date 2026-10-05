import { Stack } from 'expo-router';
import { useTheme } from '@/hooks/use-theme';
import { DriverProvider } from '@/features/driver/state/driver-provider';

export default function DriverLayout() {
  const theme = useTheme();
  return <DriverProvider>
    <Stack screenOptions={{ headerStyle: { backgroundColor: theme.background }, headerTintColor: theme.text, title: 'Tài xế' }}>
      <Stack.Screen name="index" options={{ title: 'Driver' }} />
      <Stack.Screen name="login" options={{ title: 'Đăng nhập' }} />
      <Stack.Screen name="(authenticated)" options={{ headerShown: false }} />
    </Stack>
  </DriverProvider>;
}
