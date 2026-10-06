import { TabList, TabSlot, TabTrigger, Tabs, type TabListProps, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, Txt, colors, space, type IconName } from '@/design';

/** Thanh tab Ride / Activity / Account của DESIGN.md: nền mờ, mục đang chọn có icon teal và chấm 4px dưới nhãn. */
export function RiderTabs() {
  return (
    <Tabs style={styles.root}>
      <TabSlot style={styles.slot} />
      <TabList asChild>
        <TabBar>
          <TabTrigger name="index" href="/" asChild><TabButton icon="directions_car" label="Đặt xe" /></TabTrigger>
          <TabTrigger name="activity" href="/activity" asChild><TabButton icon="history" label="Hoạt động" /></TabTrigger>
          <TabTrigger name="account" href="/account" asChild><TabButton icon="person" label="Tài khoản" /></TabTrigger>
        </TabBar>
      </TabList>
    </Tabs>
  );
}

function TabBar({ children, style, ...props }: TabListProps) {
  const insets = useSafeAreaInsets();
  return <View {...props} style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.sm) }, style]}>{children}</View>;
}

function TabButton({ icon, label, isFocused, ...props }: TabTriggerSlotProps & { icon: IconName; label: string }) {
  const color = isFocused ? colors.primary : colors.slateMuted;
  return (
    <Pressable {...props} accessibilityRole="tab" accessibilityState={{ selected: !!isFocused }} accessibilityLabel={label} style={styles.button}>
      <Icon name={icon} size={22} color={color} />
      <Txt variant="label-md" color={color}>{label}</Txt>
      <View style={[styles.dot, { backgroundColor: isFocused ? colors.primary : 'transparent' }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  slot: { flex: 1 },
  bar: {
    flexDirection: 'row', paddingTop: space.sm, paddingHorizontal: space.sm, backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outlineVariant,
  },
  button: { flex: 1, alignItems: 'center', gap: 2, minHeight: 48 },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },
});
