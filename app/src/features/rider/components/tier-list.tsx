import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Pill, Placeholder, Txt, colors, radius, shadows, space } from '@/design';
import type { QuoteState } from '../booking';
import { errorText } from '../errors';
import { formatDistance, formatDuration, formatVnd } from '../format';
import { vehicleTier } from '../vehicles';

/** Danh sách loại xe như "Available Rides" của Stitch: thẻ đang chọn nền xanh nhạt, dấu tích và giá màu teal. */
export function TierList({ vehicleTypes, quotes, selected, onSelect }: {
  vehicleTypes: string[]; quotes: Record<string, QuoteState>; selected: string | null; onSelect: (type: string) => void;
}) {
  return (
    <View style={styles.list}>
      {vehicleTypes.map((type) => {
        const state = quotes[type];
        if (!state || (state.status === 'loading' && !state.quote)) return <Placeholder key={type} height={72} />;
        return <TierCard key={type} type={type} state={state} selected={selected === type} onPress={() => onSelect(type)} />;
      })}
    </View>
  );
}

function TierCard({ type, state, selected, onPress }: { type: string; state: QuoteState; selected: boolean; onPress: () => void }) {
  const tier = vehicleTier(type);
  const quote = state.quote;
  const available = state.status === 'ready' && !!quote;
  const detail = available && quote
    ? `${tier.subtitle} · ${formatDistance(quote.route.distanceMeters)} · ${formatDuration(quote.route.durationSeconds)}`
    : state.status === 'error' ? errorText(state.error) : tier.subtitle;
  return (
    <Pressable
      accessibilityRole="radio" accessibilityState={{ selected, disabled: !available }} accessibilityLabel={`${tier.title}, ${available && quote ? formatVnd(quote.fare.amount) : 'chưa có giá'}`}
      disabled={!available} onPress={onPress}
      style={({ pressed }) => [styles.card, selected ? styles.selected : styles.idle, !available && styles.unavailable, pressed && styles.pressed]}>
      <View style={styles.leading}>
        <View style={[styles.iconBox, selected && styles.iconBoxSelected]}>
          <Icon name={tier.icon} size={26} color={selected ? colors.onPrimary : colors.primary} />
          {selected ? <View style={styles.check}><Icon name="check" size={10} color={colors.onPrimary} /></View> : null}
        </View>
        <View style={styles.text}>
          <View style={styles.titleRow}>
            <Txt variant="title-md" weight={selected ? 'bold' : 'semibold'} numberOfLines={1}>{tier.title}</Txt>
            {tier.badge ? <Pill label={tier.badge.label} tone={tier.badge.tone} /> : null}
          </View>
          <Txt variant="body-sm" color={state.status === 'error' ? colors.error : colors.onSurfaceVariant} numberOfLines={1}>{detail}</Txt>
        </View>
      </View>
      <View style={styles.price}>
        <Txt variant="title-md" weight="bold" tabular color={selected ? colors.primary : colors.onSurface}>
          {available && quote ? formatVnd(quote.fare.amount) : '—'}
        </Txt>
        {state.status === 'loading' ? <Txt variant="label-sm" color={colors.outline}>Đang cập nhật</Txt> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.xs },
  card: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.sm, borderRadius: radius.md, gap: space.sm },
  idle: { backgroundColor: colors.surfaceContainerLowest, boxShadow: shadows.card },
  selected: { backgroundColor: 'rgba(218, 226, 253, 0.5)', boxShadow: shadows.raised },
  unavailable: { opacity: 0.6 },
  pressed: { transform: [{ scale: 0.99 }] },
  leading: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1, minWidth: 0 },
  iconBox: { width: 56, height: 48, borderRadius: radius.md, backgroundColor: 'rgba(220, 233, 255, 0.6)', alignItems: 'center', justifyContent: 'center' },
  iconBoxSelected: { backgroundColor: colors.primaryContainer },
  check: {
    position: 'absolute', top: -6, left: -6, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  price: { alignItems: 'flex-end', paddingLeft: space.xs },
});
