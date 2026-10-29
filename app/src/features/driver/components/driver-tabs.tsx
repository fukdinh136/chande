import { Pressable, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { palette } from '../../ui/design';

const tabs = [
  { key: 'home', label: 'Trang chủ', icon: 'navigate-outline', href: '/driver' },
  { key: 'history', label: 'Lịch sử', icon: 'receipt-outline', href: '/driver/history' },
  { key: 'profile', label: 'Hồ sơ', icon: 'person-outline', href: '/driver/profile' },
] as const;
export function DriverTabs() {
  const path = usePathname(), theme = useTheme();
  const selectedColor = theme.background === '#000000' ? '#8be0d6' : palette.primary;
  const current = path.includes('/history') || path.includes('/trips/') ? 'history' : path.includes('/profile') || path.includes('/vehicles') ? 'profile' : 'home';
  return <View style={{ flexDirection: 'row', backgroundColor: theme.backgroundElement, borderTopWidth: 1, borderColor: palette.line, paddingVertical: 8 }}>
    {tabs.map(tab => <Pressable key={tab.key} accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected: current === tab.key }}
      onPress={() => router.replace(tab.href)} style={({pressed}) => ({ flex: 1, minHeight: 52, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', gap: 4, opacity: pressed ? 0.65 : 1 })}>
      <Ionicons name={tab.icon} size={22} color={current === tab.key ? selectedColor : theme.textSecondary} />
      <ThemedText type={current === tab.key ? 'smallBold' : 'small'} style={{ textAlign: 'center' }}>{tab.label}</ThemedText>
    </Pressable>)}
  </View>;
}
