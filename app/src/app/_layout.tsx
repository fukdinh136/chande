import { DarkTheme, DefaultTheme, ThemeProvider,Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import {appRole} from '@/features/backend/app-role';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {appRole()==='combined'?<AppTabs />:<Stack screenOptions={{headerShown:false}}/>}
    </ThemeProvider>
  );
}
