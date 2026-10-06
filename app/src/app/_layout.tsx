import { DefaultTheme, ThemeProvider,Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import {useEffect} from 'react';
import {useFonts,Inter_400Regular,Inter_600SemiBold,Inter_700Bold} from '@expo-google-fonts/inter';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const [loaded,error]=useFonts({Inter_400Regular,Inter_600SemiBold,Inter_700Bold});
  useEffect(()=>{if(loaded||error)void SplashScreen.hideAsync()},[loaded,error]);
  if(!loaded&&!error)return null;
  return (
    <ThemeProvider value={DefaultTheme}>
      <Stack screenOptions={{headerShown:false}}/>
    </ThemeProvider>
  );
}
