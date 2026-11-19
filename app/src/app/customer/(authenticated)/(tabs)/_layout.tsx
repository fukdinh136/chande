import {Tabs, router} from 'expo-router';
import {SafeAreaView} from 'react-native-safe-area-context';
import AppTabs from '@/components/app-tabs';
import {palette} from '@/features/ui/design';

const paths = {home: '/customer', history: '/customer/history', account: '/customer/account'} as const;
export default function CustomerTabsLayout() {
  return <Tabs backBehavior="history" screenOptions={{headerShown: false, tabBarHideOnKeyboard: true}} tabBar={({state}) => {
    const name = state.routes[state.index].name;
    return <SafeAreaView edges={['bottom']} style={{backgroundColor: palette.card}}>
      <AppTabs value={name === 'index' ? 'home' : name} onChange={value => router.navigate(paths[value as keyof typeof paths])}/>
    </SafeAreaView>;
  }}>
    <Tabs.Screen name="index" options={{title: 'Đặt xe'}}/>
    <Tabs.Screen name="history" options={{title: 'Lịch sử'}}/>
    <Tabs.Screen name="account" options={{title: 'Tài khoản'}}/>
  </Tabs>;
}
