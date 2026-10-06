import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Inset } from './surface';
import { Txt } from './text';
import { colors, radius, space } from './tokens';

export interface WaypointRow {
  label: string;
  title: string | null;
  placeholder: string;
  onPress?: () => void;
  trailing?: ReactNode;
}

function Row({ row, marker }: { row: WaypointRow; marker: ReactNode }) {
  const content = (
    <>
      {marker}
      <View style={styles.text}>
        <Txt variant="label-sm" uppercase color={colors.onSurfaceVariant}>{row.label}</Txt>
        <Txt variant="title-md" numberOfLines={1} color={row.title ? colors.onSurface : colors.slateMuted}>{row.title ?? row.placeholder}</Txt>
      </View>
      {row.trailing}
    </>
  );
  if (!row.onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${row.label}: ${row.title ?? row.placeholder}`} onPress={row.onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

/** Khối điểm đón (chấm xanh) – điểm đến (ô vuông đỏ) nối bằng vạch, như màn hình Stitch. */
export function WaypointCard({ pickup, destination }: { pickup: WaypointRow; destination: WaypointRow }) {
  return (
    <Inset style={styles.card}>
      <Row row={pickup} marker={<View style={styles.pickupDot} />} />
      <View style={styles.connector} />
      <Row row={destination} marker={<View style={styles.destinationSquare} />} />
    </Inset>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, borderRadius: radius.sm },
  pressed: { opacity: 0.7 },
  text: { flex: 1, minWidth: 0 },
  pickupDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.tertiary, marginLeft: space.xs },
  destinationSquare: { width: 12, height: 12, borderRadius: 3, backgroundColor: colors.error, marginLeft: space.xs },
  connector: { width: 2, height: 12, borderRadius: 1, backgroundColor: colors.outlineVariant, marginLeft: space.sm + 1 },
});
