import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  AppHeader, Avatar, Banner, Card, Divider, EmptyState, Icon, IconButton, Loading, PrimaryButton, SecondaryButton, TextField, Txt,
  colors, radius, space, type IconName,
} from '@/design';
import { ProfileAvatar, RiderScreen } from '../components/rider-screen';
import { addressIcon } from '../components/saved-places';
import { errorText, fieldError } from '../errors';
import { formatCoordinates, formatDateTime, formatPhone } from '../format';
import type { SavedAddress } from '../models';
import { useRider } from '../provider';
import { useStore } from '../store';

/** Hỏi xác nhận; web không có Alert nhiều nút nên dùng window.confirm. */
function confirmAction(title: string, message: string, action: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${title}\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [{ text: 'Không', style: 'cancel' }, { text: action, style: 'destructive', onPress: onConfirm }]);
}

function MenuRow({ icon, label, detail, onPress, danger = false }: { icon: IconName; label: string; detail?: string; onPress: () => void; danger?: boolean }) {
  const color = danger ? colors.error : colors.onSurface;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
      <View style={[styles.menuIcon, danger && styles.menuIconDanger]}><Icon name={icon} size={18} color={danger ? colors.error : colors.primary} /></View>
      <View style={styles.flex}>
        <Txt variant="title-md" color={color}>{label}</Txt>
        {detail ? <Txt variant="body-sm" color={colors.onSurfaceVariant}>{detail}</Txt> : null}
      </View>
      {!danger ? <Icon name="chevron_right" size={18} color={colors.outline} /> : null}
    </Pressable>
  );
}

/** Tab "Tài khoản". */
export function AccountScreen() {
  const { account, session } = useRider();
  const state = useStore(account);
  const [error, setError] = useState<unknown>(null);
  useFocusEffect(useCallback(() => { void account.refreshProfile(); }, [account]));
  const profile = state.profile;
  return (
    <View style={styles.root}>
      <AppHeader title="Tài khoản" right={<ProfileAvatar />} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.profile}>
          <Avatar name={profile?.fullName} uri={profile?.avatarUrl} size={64} />
          <View style={styles.flex}>
            <Txt variant="headline-sm" numberOfLines={1}>{profile?.fullName ?? 'Đang tải…'}</Txt>
            {profile ? <Txt variant="body-md" tabular color={colors.onSurfaceVariant}>{formatPhone(profile.phoneNumber)}</Txt> : null}
            {profile ? <Txt variant="body-sm" color={colors.slateMuted}>Thành viên từ {formatDateTime(profile.createdAt).slice(0, 10)}</Txt> : null}
          </View>
        </Card>
        {state.error ? <Banner tone="error" message={errorText(state.error)} /> : null}
        {error ? <Banner tone="error" message={errorText(error)} /> : null}
        <Card style={styles.menu}>
          <MenuRow icon="person" label="Thông tin cá nhân" detail="Họ tên, ảnh đại diện" onPress={() => router.push('/profile')} />
          <Divider />
          <MenuRow icon="home" label="Địa chỉ đã lưu" detail="Nhà, công ty và nơi hay đến" onPress={() => router.push('/addresses')} />
          <Divider />
          <MenuRow icon="lock" label="Đổi mật khẩu" onPress={() => router.push('/password')} />
          <Divider />
          <MenuRow icon="local_taxi" label="Ứng dụng tài xế" detail="Chuyển sang chế độ tài xế" onPress={() => router.push('/driver')} />
        </Card>
        <Card style={styles.menu}>
          <MenuRow icon="logout" label="Đăng xuất" danger onPress={() => confirmAction('Đăng xuất?', 'Bạn sẽ cần đăng nhập lại trên máy này.', 'Đăng xuất', () => { void session.logout(); })} />
          <Divider />
          <MenuRow icon="devices" label="Đăng xuất khỏi mọi thiết bị" danger onPress={() => confirmAction(
            'Đăng xuất mọi thiết bị?', 'Mọi phiên đăng nhập của tài khoản sẽ bị thu hồi.', 'Đăng xuất hết',
            () => { session.logoutAll().catch(setError); },
          )} />
        </Card>
      </ScrollView>
    </View>
  );
}

/** P2: sửa họ tên và URL ảnh đại diện (không xoá được ảnh qua API). */
export function ProfileScreen() {
  const { account, users } = useRider();
  const { profile } = useStore(account);
  const [fullName, setFullName] = useState(profile?.fullName ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (profile) {
      setFullName((value) => value || profile.fullName);
      setAvatarUrl((value) => value || profile.avatarUrl || '');
    }
  }, [profile]);
  const local = {
    fullName: !fullName.trim() ? 'Họ tên không được để trống' : fullName.length > 100 ? 'Họ tên tối đa 100 ký tự' : null,
    avatarUrl: avatarUrl && !/^https?:\/\/\S+$/.test(avatarUrl.trim()) ? 'URL ảnh phải bắt đầu bằng http:// hoặc https://' : null,
  };
  const save = async () => {
    if (local.fullName || local.avatarUrl || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const patch: { fullName?: string; avatarUrl?: string } = { fullName: fullName.trim() };
      if (avatarUrl.trim()) patch.avatarUrl = avatarUrl.trim();
      account.setProfile(await users.updateMe(patch));
      setSaved(true);
    } catch (failure) { setError(failure); } finally { setBusy(false); }
  };
  return (
    <RiderScreen title="Thông tin cá nhân" footer={<PrimaryButton label="Lưu thay đổi" icon="check" loading={busy} onPress={() => { void save(); }} />}>
      <View style={styles.center}><Avatar name={fullName} uri={avatarUrl.trim() || null} size={88} /></View>
      {saved ? <Banner tone="success" message="Đã lưu thông tin." /> : null}
      {error ? <Banner tone="error" message={errorText(error)} /> : null}
      <TextField label="Họ tên" value={fullName} onChangeText={setFullName} maxLength={100} error={local.fullName ?? fieldError(error, 'fullName')} />
      <TextField label="Ảnh đại diện (URL)" value={avatarUrl} onChangeText={setAvatarUrl} placeholder="https://…" autoCapitalize="none" keyboardType="url"
        maxLength={500} hint="Hệ thống chưa hỗ trợ xoá ảnh đại diện." error={local.avatarUrl ?? fieldError(error, 'avatarUrl')} />
      {profile ? <TextField label="Số điện thoại" value={formatPhone(profile.phoneNumber)} editable={false} hint="Không đổi được số điện thoại." /> : null}
    </RiderScreen>
  );
}

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).+$/;

/** P3: đổi mật khẩu; User Service thu hồi mọi phiên nên app đăng xuất và yêu cầu đăng nhập lại. */
export function PasswordScreen() {
  const { users, session } = useRider();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const newError = newPassword && (newPassword.length < 8 || newPassword.length > 72) ? 'Mật khẩu mới phải từ 8 đến 72 ký tự'
    : newPassword && !PASSWORD_RULE.test(newPassword) ? 'Mật khẩu mới phải có cả chữ và số' : null;
  const submit = async () => {
    if (!oldPassword || !newPassword || newError || busy) return;
    setBusy(true);
    setError(null);
    try {
      await users.changePassword(oldPassword, newPassword);
      await session.endAfterPasswordChange();
    } catch (failure) { setError(failure); } finally { setBusy(false); }
  };
  return (
    <RiderScreen title="Đổi mật khẩu" footer={<PrimaryButton label="Đổi mật khẩu" icon="lock" loading={busy} disabled={!oldPassword || !newPassword || !!newError} onPress={() => { void submit(); }} />}>
      <Banner tone="info" message="Sau khi đổi mật khẩu, mọi thiết bị sẽ bị đăng xuất và bạn cần đăng nhập lại." />
      {error && !fieldError(error, 'oldPassword') && !fieldError(error, 'newPassword') ? <Banner tone="error" message={errorText(error)} /> : null}
      <TextField label="Mật khẩu hiện tại" value={oldPassword} onChangeText={setOldPassword} secureTextEntry autoCapitalize="none" maxLength={72}
        autoComplete="current-password" error={fieldError(error, 'oldPassword')} />
      <TextField label="Mật khẩu mới" value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" maxLength={72}
        autoComplete="new-password" hint="8–72 ký tự, có cả chữ và số" error={newError ?? fieldError(error, 'newPassword')} />
    </RiderScreen>
  );
}

/** D1–D5: danh sách địa chỉ đã lưu. */
export function AddressesScreen() {
  const { account, users } = useRider();
  const { addresses, loadingAddresses, error } = useStore(account);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  useFocusEffect(useCallback(() => { void account.refreshAddresses(); }, [account]));
  const run = async (id: string, job: () => Promise<unknown>) => {
    setBusyId(id);
    setActionError(null);
    try { await job(); await account.refreshAddresses(); } catch (failure) { setActionError(failure); } finally { setBusyId(null); }
  };
  const full = (addresses?.length ?? 0) >= 10;
  return (
    <RiderScreen title="Địa chỉ đã lưu" footer={(
      <PrimaryButton label="Thêm địa chỉ" icon="add" disabled={full} onPress={() => { account.setDraftPlace(null); router.push('/addresses/edit'); }} />
    )}>
      {full ? <Banner tone="info" message="Bạn đã lưu tối đa 10 địa chỉ." /> : null}
      {error || actionError ? <Banner tone="error" message={errorText(actionError ?? error)} /> : null}
      {!addresses && loadingAddresses ? <Loading /> : null}
      {addresses && !addresses.length ? <EmptyState icon="home" title="Chưa có địa chỉ nào" message="Lưu nhà, công ty để đặt xe nhanh hơn." /> : null}
      {addresses?.map((address) => (
        <AddressCard key={address.id} address={address} busy={busyId === address.id}
          onEdit={() => { account.setDraftPlace(null); router.push({ pathname: '/addresses/edit', params: { id: address.id } }); }}
          onDefault={() => { void run(address.id, () => users.setDefaultAddress(address.id)); }}
          onDelete={() => confirmAction('Xoá địa chỉ?', address.label ?? address.addressText, 'Xoá', () => { void run(address.id, () => users.deleteAddress(address.id)); })} />
      ))}
    </RiderScreen>
  );
}

function AddressCard({ address, busy, onEdit, onDefault, onDelete }: { address: SavedAddress; busy: boolean; onEdit: () => void; onDefault: () => void; onDelete: () => void }) {
  return (
    <Card style={styles.address}>
      <View style={styles.addressTop}>
        <View style={styles.menuIcon}><Icon name={addressIcon(address.label)} size={18} color={colors.primary} /></View>
        <View style={styles.flex}>
          <Txt variant="title-md" numberOfLines={1}>{address.label ?? 'Địa chỉ'}</Txt>
          <Txt variant="body-sm" color={colors.onSurfaceVariant} numberOfLines={2}>{address.addressText}</Txt>
        </View>
        {address.isDefault ? <View style={styles.defaultTag}><Txt variant="label-sm" color={colors.onPrimaryFixed}>Mặc định</Txt></View> : null}
      </View>
      <View style={styles.addressActions}>
        <IconButton icon="edit" label="Sửa địa chỉ" variant="tonal" size={36} disabled={busy} onPress={onEdit} />
        {!address.isDefault ? <IconButton icon="star" label="Đặt làm mặc định" variant="tonal" size={36} disabled={busy} onPress={onDefault} /> : null}
        <IconButton icon="delete" label="Xoá địa chỉ" variant="tonal" size={36} color={colors.error} disabled={busy} onPress={onDelete} />
      </View>
    </Card>
  );
}

/** D2/D3: thêm hoặc sửa một địa chỉ; toạ độ chọn ở màn chọn điểm (target=address). */
export function AddressFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { account, users } = useRider();
  const { addresses, draftPlace } = useStore(account);
  const existing = id ? addresses?.find((item) => item.id === id) ?? null : null;
  const [label, setLabel] = useState(existing?.label ?? '');
  const [addressText, setAddressText] = useState(existing?.addressText ?? '');
  const [makeDefault, setMakeDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const point = draftPlace ?? (existing ? { lat: existing.lat, lng: existing.lng } : null);
  useEffect(() => {
    if (draftPlace?.address) setAddressText((value) => value || draftPlace.address || '');
  }, [draftPlace]);
  const local = {
    label: label.length > 50 ? 'Tên gợi nhớ tối đa 50 ký tự' : null,
    addressText: !addressText.trim() ? 'Địa chỉ không được để trống' : addressText.length > 500 ? 'Địa chỉ tối đa 500 ký tự' : null,
  };
  const save = async () => {
    if (!point || local.label || local.addressText || busy) return;
    setBusy(true);
    setError(null);
    try {
      const input = { label: label.trim() || null, addressText: addressText.trim(), lat: point.lat, lng: point.lng, ...(makeDefault ? { makeDefault: true } : {}) };
      if (existing) await users.updateAddress(existing.id, input); else await users.createAddress(input);
      account.setDraftPlace(null);
      await account.refreshAddresses();
      if (router.canGoBack()) router.back(); else router.replace('/addresses');
    } catch (failure) { setError(failure); } finally { setBusy(false); }
  };
  return (
    <RiderScreen title={existing ? 'Sửa địa chỉ' : 'Thêm địa chỉ'}
      footer={<PrimaryButton label="Lưu địa chỉ" icon="check" loading={busy} disabled={!point} onPress={() => { void save(); }} />}>
      {error ? <Banner tone="error" message={errorText(error)} /> : null}
      <TextField label="Tên gợi nhớ (tuỳ chọn)" value={label} onChangeText={setLabel} placeholder="Nhà, Công ty…" maxLength={50} error={local.label ?? fieldError(error, 'label')} />
      <Card onPress={() => router.push({ pathname: '/place', params: { target: 'address' } })} accessibilityLabel="Chọn vị trí trên bản đồ" style={styles.pointCard}>
        <Icon name="pin_drop" size={20} color={colors.primary} />
        <View style={styles.flex}>
          <Txt variant="title-md">{point ? 'Vị trí đã chọn' : 'Chọn vị trí'}</Txt>
          <Txt variant="body-sm" tabular color={colors.onSurfaceVariant}>{point ? formatCoordinates(point.lat, point.lng) : 'Tìm kiếm hoặc ghim trên bản đồ'}</Txt>
        </View>
        <Icon name="chevron_right" size={18} color={colors.outline} />
      </Card>
      <TextField label="Địa chỉ" value={addressText} onChangeText={setAddressText} multiline maxLength={500}
        placeholder="Số nhà, đường, phường, quận" error={local.addressText ?? fieldError(error, 'addressText')} />
      {!existing?.isDefault ? (
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: makeDefault }} onPress={() => setMakeDefault(!makeDefault)} style={styles.checkbox}>
          <Icon name={makeDefault ? 'check_circle' : 'radio_button_unchecked'} size={22} color={makeDefault ? colors.primary : colors.outline} />
          <Txt variant="body-md">Đặt làm địa chỉ mặc định</Txt>
        </Pressable>
      ) : null}
      <SecondaryButton label="Huỷ" onPress={() => { account.setDraftPlace(null); if (router.canGoBack()) router.back(); }} />
    </RiderScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, minWidth: 0 },
  content: { padding: space.gutter, gap: space.md, paddingBottom: space.xl },
  center: { alignItems: 'center' },
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  menu: { paddingVertical: space.xs, gap: 0 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.sm },
  menuIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  menuIconDanger: { backgroundColor: colors.errorContainer },
  pressed: { opacity: 0.7 },
  address: { gap: space.sm },
  addressTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  addressActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.xs },
  defaultTag: { backgroundColor: colors.primaryFixed, paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.full },
  pointCard: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  checkbox: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
});
