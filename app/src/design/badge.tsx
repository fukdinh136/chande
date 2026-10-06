import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Txt } from './text';
import { colors, radius, statusColors, type StatusTone } from './tokens';

/** Badge trạng thái chuyến theo DESIGN.md; trạng thái đang tìm có chấm nhấp nháy. */
export function StatusBadge({ tone, label, pulse = tone === 'searching' }: { tone: StatusTone; label: string; pulse?: boolean }) {
  const palette = statusColors[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette.background }]} accessible accessibilityLabel={label}>
      <PulseDot color={palette.dot} active={pulse} />
      <Txt variant="label-sm" uppercase color={palette.text}>{label}</Txt>
    </View>
  );
}

export function PulseDot({ color, active, size = 8 }: { color: string; active: boolean; size?: number }) {
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!active) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.25, duration: 700, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [active, opacity]);
  return <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity }} />;
}

const pillTones = {
  primary: { background: colors.primaryFixed, text: colors.onPrimaryFixed },
  tertiary: { background: colors.tertiaryFixed, text: colors.onTertiaryFixed },
  neutral: { background: colors.raised, text: colors.slateMuted },
  danger: { background: colors.errorContainer, text: colors.onErrorContainer },
} as const;

/** Nhãn nhỏ cạnh tên loại xe ("Nhanh", "Phổ biến"). */
export function Pill({ label, tone = 'neutral' }: { label: string; tone?: keyof typeof pillTones }) {
  const palette = pillTones[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.background }]}>
      <Txt variant="label-sm" color={palette.text}>{label}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6,
    paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.full,
  },
  pill: { paddingVertical: 2, paddingHorizontal: 6, borderRadius: radius.full },
});
