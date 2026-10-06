import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { useAppFonts } from '@/design/fonts';

SplashScreen.preventAutoHideAsync();

// App khách ở nhóm (rider) là màn hình mặc định "/"; app tài xế giữ nguyên ở /driver.
export default function RootLayout() {
  const colorScheme = useColorScheme();
  const fontsReady = useAppFonts();
  useEffect(() => {
    if (fontsReady) void SplashScreen.hideAsync();
  }, [fontsReady]);
  if (!fontsReady) return null;
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(rider)" />
        <Stack.Screen name="driver" />
      </Stack>
    </ThemeProvider>
  );
}
