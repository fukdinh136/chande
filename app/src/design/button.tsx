import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, type IconName } from './icon';
import { Txt } from './text';
import { colors, radius, shadows, space } from './tokens';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}

/** CTA chính: viên thuốc cao 56, nền teal, nhấn thu nhỏ 0.98. `trailing` hiện giá tiền bên phải như "Confirm Ride". */
export function PrimaryButton({ label, onPress, disabled, loading, icon, trailing, style }: ButtonProps & { trailing?: string }) {
  const inactive = !!disabled || !!loading;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={trailing ? `${label}, ${trailing}` : label}
      accessibilityState={{ disabled: inactive, busy: !!loading }} disabled={inactive} onPress={onPress}
      style={({ pressed }) => [styles.primary, trailing ? styles.spread : styles.centered, inactive && styles.inactive, pressed && styles.pressed, style]}>
      <View style={styles.row}>
        {loading ? <ActivityIndicator color={colors.onPrimary} /> : icon ? <Icon name={icon} size={20} color={colors.onPrimary} /> : null}
        <Txt variant="label-lg" weight="bold" color={colors.onPrimary}>{label}</Txt>
      </View>
      {trailing ? <Txt variant="headline-sm" weight="bold" tabular color={colors.onPrimary}>{trailing}</Txt> : null}
    </Pressable>
  );
}

/** Nút phụ cao 48, viền mảnh. `tone="danger"` cho thao tác huỷ/xoá. */
export function SecondaryButton({ label, onPress, disabled, loading, icon, style, tone = 'neutral' }: ButtonProps & { tone?: 'neutral' | 'danger' }) {
  const inactive = !!disabled || !!loading;
  const color = tone === 'danger' ? colors.error : colors.slate;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: inactive, busy: !!loading }}
      disabled={inactive} onPress={onPress}
      style={({ pressed }) => [styles.secondary, inactive && styles.inactive, pressed && styles.pressed, style]}>
      {loading ? <ActivityIndicator color={color} /> : icon ? <Icon name={icon} size={18} color={color} /> : null}
      <Txt variant="label-lg" color={color}>{label}</Txt>
    </Pressable>
  );
}

export function TextButton({ label, onPress, disabled, color = colors.primary, style }: Omit<ButtonProps, 'icon' | 'loading'> & { color?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
      hitSlop={8} style={({ pressed }) => [styles.text, (disabled || pressed) && styles.inactive, style]}>
      <Txt variant="label-md" weight="bold" color={color}>{label}</Txt>
    </Pressable>
  );
}

/** Nút tròn nổi trên bản đồ (căn giữa lại, la bàn...): 44×44, nền trắng, bóng cấp 4. */
export function IconButton({ icon, label, onPress, disabled, size = 44, variant = 'floating', color = colors.slate, style }: {
  icon: IconName; label: string; onPress?: () => void; disabled?: boolean; size?: number;
  variant?: 'floating' | 'plain' | 'tonal'; color?: string; style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled}
      onPress={onPress} hitSlop={6}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2 }, styles.iconButton,
        variant === 'floating' && styles.floating, variant === 'tonal' && styles.tonal,
        disabled && styles.inactive, pressed && styles.pressed, style,
      ]}>
      <Icon name={icon} size={Math.round(size * 0.46)} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: {
    height: 56, borderRadius: radius.full, backgroundColor: colors.primary, paddingHorizontal: space.lg,
    flexDirection: 'row', alignItems: 'center', boxShadow: shadows.raised,
  },
  centered: { justifyContent: 'center' },
  spread: { justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  secondary: {
    minHeight: 48, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.surfaceContainerLowest,
    paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
  },
  text: { paddingVertical: space.xs, paddingHorizontal: space.sm, borderRadius: radius.sm },
  iconButton: { alignItems: 'center', justifyContent: 'center' },
  floating: { backgroundColor: colors.surfaceContainerLowest, boxShadow: shadows.float },
  tonal: { backgroundColor: colors.surfaceContainer },
  inactive: { opacity: 0.5 },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.92 },
});
