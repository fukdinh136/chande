import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from './icon';
import { Txt } from './text';
import { colors, radius, space } from './tokens';

const tones = {
  info: { icon: 'info', background: colors.surfaceContainer, color: colors.onSurfaceVariant },
  error: { icon: 'error', background: colors.errorContainer, color: colors.onErrorContainer },
  warning: { icon: 'warning', background: '#FEF3C7', color: '#92400E' },
  success: { icon: 'verified', background: '#D1FAE5', color: '#065F46' },
} as const satisfies Record<string, { icon: IconName; background: string; color: string }>;

/** Thông báo trong dòng (lỗi, cảnh báo, gợi ý). */
export function Banner({ tone = 'info', title, message, action }: { tone?: keyof typeof tones; title?: string; message: string; action?: ReactNode }) {
  const palette = tones[tone];
  return (
    <View style={[styles.banner, { backgroundColor: palette.background }]} accessibilityLiveRegion="polite">
      <Icon name={palette.icon} size={18} color={palette.color} />
      <View style={styles.bannerBody}>
        {title ? <Txt variant="label-lg" color={palette.color}>{title}</Txt> : null}
        <Txt variant="body-sm" color={palette.color}>{message}</Txt>
        {action}
      </View>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.loading} accessibilityLabel={label ?? 'Đang tải'}>
      <ActivityIndicator color={colors.primary} />
      {label ? <Txt variant="body-sm" color={colors.slateMuted}>{label}</Txt> : null}
    </View>
  );
}

export function EmptyState({ icon, title, message, action }: { icon: IconName; title: string; message?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><Icon name={icon} size={28} color={colors.primary} /></View>
      <Txt variant="headline-sm" align="center">{title}</Txt>
      {message ? <Txt variant="body-md" align="center" color={colors.onSurfaceVariant}>{message}</Txt> : null}
      {action}
    </View>
  );
}

/** Khối giữ chỗ khi đang tải danh sách. */
export function Placeholder({ height = 64 }: { height?: number }) {
  return <View style={[styles.placeholder, { height }]} />;
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md, alignItems: 'flex-start' },
  bannerBody: { flex: 1, gap: 2 },
  loading: { padding: space.lg, alignItems: 'center', gap: space.sm },
  empty: { paddingVertical: space.xl, paddingHorizontal: space.lg, alignItems: 'center', gap: space.sm },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  placeholder: { borderRadius: radius.md, backgroundColor: colors.raised },
});
