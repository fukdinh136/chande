import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Txt } from './text';
import { colors, radius, shadows, space } from './tokens';

/** Thẻ nổi cấp 2: nền trắng, viền mờ, bóng nhẹ. */
export function Card({ children, style, onPress, accessibilityLabel }: PropsWithChildren<{ style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }>) {
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Khối chìm cấp 1 (ô nhập, khối điểm đón/điểm đến). */
export function Inset({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.inset, style]}>{children}</View>;
}

export function SheetHandle() {
  return <View style={styles.handle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

/** Tiêu đề nhóm nội dung như "Available Rides" + thao tác phụ bên phải. */
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.section}>
      <Txt variant="label-lg">{title}</Txt>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.md, borderWidth: 1, borderColor: colors.ghostBorder,
    padding: space.md, boxShadow: shadows.card,
  },
  pressed: { transform: [{ scale: 0.99 }] },
  inset: { backgroundColor: colors.surfaceContainerLow, borderRadius: radius.md, padding: space.sm },
  handle: { width: 40, height: 4, borderRadius: radius.full, backgroundColor: colors.outlineVariant, opacity: 0.6, alignSelf: 'center' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.outlineVariant },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
});
