import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from './button';
import { Icon } from './icon';
import { Txt } from './text';
import { colors, radius, shadows, space } from './tokens';

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <View style={[styles.brand, { width: size, height: size, borderRadius: size * 0.3 }]}>
      <Icon name="bolt" size={size * 0.6} color={colors.onPrimary} />
    </View>
  );
}

/** Thanh đầu trang như thiết kế: nút quay lại, logo, dòng "CHANDE" và tiêu đề, phần tử bên phải (ảnh đại diện). */
export function AppHeader({ title, overline = 'Chande', onBack, right }: { title: string; overline?: string; onBack?: () => void; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <View style={styles.leading}>
          {onBack ? <IconButton icon="arrow_back" label="Quay lại" onPress={onBack} variant="plain" style={styles.back} /> : null}
          <BrandMark />
          <View style={styles.titles}>
            <Txt variant="label-sm" uppercase color={colors.primary}>{overline}</Txt>
            <Txt variant="title-md" numberOfLines={1} accessibilityRole="header">{title}</Txt>
          </View>
        </View>
        {right}
      </View>
    </View>
  );
}

export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const letters = words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[words.length - 1][0]}`;
  return letters.toUpperCase();
}

export function Avatar({ name, uri, size = 32 }: { name?: string | null; uri?: string | null; size?: number }) {
  const shape = { width: size, height: size, borderRadius: size / 2 };
  if (uri && /^https:\/\//.test(uri)) {
    return <Image source={{ uri }} style={[shape, styles.avatarImage]} contentFit="cover" accessibilityLabel={name ?? 'Ảnh đại diện'} />;
  }
  return (
    <View style={[shape, styles.avatar]} accessibilityLabel={name ?? 'Ảnh đại diện'}>
      <Txt variant={size >= 48 ? 'headline-sm' : 'label-md'} color={colors.onPrimaryFixed}>{initials(name)}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: 'rgba(248, 249, 255, 0.94)', boxShadow: shadows.soft, zIndex: 10 },
  bar: { height: 64, paddingHorizontal: space.gutter, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  leading: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
  back: { marginLeft: -space.sm },
  titles: { flexShrink: 1 },
  brand: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatar: { backgroundColor: colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  avatarImage: { backgroundColor: colors.surfaceContainer, borderRadius: radius.full },
});
