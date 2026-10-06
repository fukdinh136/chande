import { Redirect, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Loading, colors } from '@/design';
import { useRiderSession } from '@/features/rider/provider';

// Các màn cần đăng nhập RIDER.
export default function RiderAppLayout() {
  const session = useRiderSession();
  if (session.status === 'restoring') {
    return <SafeAreaView style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.surface }}><Loading label="Đang khôi phục phiên…" /></SafeAreaView>;
  }
  if (session.status !== 'signedIn') return <Redirect href="/login" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
