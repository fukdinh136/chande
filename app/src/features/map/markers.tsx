import { StyleSheet, View } from 'react-native';
import { Icon, PulseDot, colors, shadows } from '@/design';

/** Điểm đón: vòng sáng nhấp nháy quanh chấm xanh (beacon trong thiết kế). */
export function PickupMarker() {
  return (
    <View style={styles.pickupHalo}>
      <View style={styles.pickup}><Icon name="my_location" size={14} color={colors.onPrimary} /></View>
    </View>
  );
}

/** Điểm đến: tròn đỏ có cờ. */
export function DestinationMarker() {
  return <View style={styles.destination}><Icon name="flag" size={16} color={colors.onError} /></View>;
}

/** Vị trí tài xế/thiết bị ở chế độ dẫn đường dự phòng. */
export function UserDot() {
  return <View style={styles.userRing}><PulseDot color={colors.route} active size={14} /></View>;
}

/** Ghim chọn vị trí đặt chính giữa vùng bản đồ: mũi ghim trùng tâm bản đồ. */
export function CenterPin() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={styles.pinAnchor}>
        <View style={styles.pinHead}><View style={styles.pinCore} /></View>
        <View style={styles.pinStem} />
        <View style={styles.pinShadow} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pickupHalo: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(82, 224, 120, 0.35)', alignItems: 'center', justifyContent: 'center' },
  pickup: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.tertiary, alignItems: 'center', justifyContent: 'center', boxShadow: shadows.card },
  destination: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.surfaceContainerLowest, boxShadow: shadows.raised,
  },
  userRing: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center', boxShadow: shadows.card },
  // Đầu ghim 32 + thân 12: mũi ghim (đáy thân) nằm đúng tâm.
  pinAnchor: { position: 'absolute', left: '50%', top: '50%', width: 32, marginLeft: -16, marginTop: -44, alignItems: 'center' },
  pinHead: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', boxShadow: shadows.float },
  pinCore: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.onPrimary },
  pinStem: { width: 3, height: 12, backgroundColor: colors.primary, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  pinShadow: { width: 10, height: 4, borderRadius: 5, backgroundColor: 'rgba(11, 28, 48, 0.25)', marginTop: 0 },
});
