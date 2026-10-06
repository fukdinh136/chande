import { useFocusEffect } from 'expo-router';
import { useCallback, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Placeholder, SectionHeader, Txt, colors, radius, shadows, space, type IconName } from '@/design';
import type { SavedAddress } from '../models';
import { useRider } from '../provider';
import { useStore } from '../store';

export function addressIcon(label: string | null): IconName {
  const text = (label ?? '').toLowerCase();
  if (/nhà|home/.test(text)) return 'home';
  if (/công ty|cơ quan|văn phòng|work|office/.test(text)) return 'work';
  return 'location_on';
}

export function PlaceRow({ icon, title, subtitle, onPress, accessory }: {
  icon: IconName; title: string; subtitle?: string | null; onPress: () => void; accessory?: ReactNode;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title} onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.icon}><Icon name={icon} size={18} color={colors.primary} /></View>
      <View style={styles.text}>
        <Txt variant="title-md" numberOfLines={1}>{title}</Txt>
        {subtitle ? <Txt variant="body-sm" color={colors.onSurfaceVariant} numberOfLines={1}>{subtitle}</Txt> : null}
      </View>
      {accessory}
    </Pressable>
  );
}

/** Địa chỉ đã lưu (User D1) để chọn nhanh điểm đến/điểm đón. */
export function SavedPlaces({ onPick, title = 'Địa chỉ đã lưu' }: { onPick: (address: SavedAddress) => void; title?: string }) {
  const { account } = useRider();
  const { addresses, loadingAddresses } = useStore(account);
  useFocusEffect(useCallback(() => { void account.refreshAddresses(); }, [account]));
  if (!addresses?.length) return loadingAddresses && !addresses ? <Placeholder height={56} /> : null;
  return (
    <View style={styles.list}>
      <SectionHeader title={title} />
      {addresses.map((address) => (
        <PlaceRow key={address.id} icon={addressIcon(address.label)} title={address.label ?? address.addressText}
          subtitle={address.label ? address.addressText : null} onPress={() => onPick(address)}
          accessory={address.isDefault ? <Icon name="star" size={16} color={colors.primary} /> : null} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.xs },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 56, padding: space.sm,
    borderRadius: radius.md, backgroundColor: colors.surfaceContainerLowest, boxShadow: shadows.card,
  },
  pressed: { opacity: 0.8 },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0 },
});
