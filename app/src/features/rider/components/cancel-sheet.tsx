import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner, Icon, PrimaryButton, SecondaryButton, SheetHandle, TextField, Txt, colors, radius, shadows, space } from '@/design';
import { errorText } from '../errors';

const REASONS = ['Tôi đổi kế hoạch', 'Chờ tài xế quá lâu', 'Đặt nhầm điểm đón hoặc điểm đến', 'Tài xế yêu cầu huỷ'];
const OTHER = 'Lý do khác';

/** Chọn lý do huỷ (Trip R07 bắt buộc 1–500 ký tự). */
export function CancelSheet({ visible, busy, error, onClose, onConfirm }: {
  visible: boolean; busy: boolean; error: unknown; onClose: () => void; onConfirm: (reason: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [choice, setChoice] = useState(REASONS[0]);
  const [other, setOther] = useState('');
  const reason = choice === OTHER ? other.trim() : choice;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={busy ? undefined : onClose} accessibilityLabel="Đóng" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.gutter) }]}>
        <SheetHandle />
        <Txt variant="headline-sm">Huỷ chuyến này?</Txt>
        <Txt variant="body-md" color={colors.onSurfaceVariant}>Chande không tính phí huỷ. Hãy cho tài xế biết lý do.</Txt>
        <View style={styles.options}>
          {[...REASONS, OTHER].map((item) => {
            const selected = item === choice;
            return (
              <Pressable key={item} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => setChoice(item)}
                style={[styles.option, selected && styles.optionSelected]}>
                <Icon name={selected ? 'check_circle' : 'radio_button_unchecked'} size={20} color={selected ? colors.primary : colors.outline} />
                <Txt variant="body-md">{item}</Txt>
              </Pressable>
            );
          })}
        </View>
        {choice === OTHER ? (
          <TextField label="Lý do" value={other} onChangeText={setOther} maxLength={500} multiline placeholder="Nhập lý do huỷ" />
        ) : null}
        {error ? <Banner tone="error" message={errorText(error)} /> : null}
        <PrimaryButton label="Xác nhận huỷ" icon="close" loading={busy} disabled={!reason} onPress={() => onConfirm(reason)} />
        <SecondaryButton label="Giữ chuyến" disabled={busy} onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.scrim },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: space.gutter, paddingTop: space.md, gap: space.md, boxShadow: shadows.sheet,
  },
  options: { gap: space.xs },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, paddingHorizontal: space.md,
    borderRadius: radius.md, backgroundColor: colors.surfaceContainerLowest, borderWidth: 1, borderColor: colors.hairline,
  },
  optionSelected: { borderColor: colors.primary, backgroundColor: '#F0FDFA' },
});
