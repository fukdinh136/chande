import { useMemo, useState } from 'react';
import type { DriverProfile } from '../contracts/models';
import { useDriverRuntime } from '../state/driver-provider';
import { useFocusedResource } from '../hooks/use-focused-resource';
import { useMutation } from '../hooks/use-mutation';
import { Action, Busy, Card, ErrorNotice, Field, Notice, RouteAction, Screen } from '../components/ui';
import { useDriverResources } from '../state/session-resources';
import { useFormDraft } from '../hooks/use-form-draft';
import { hasErrors, profileInput, serverFields, validateProfile, writeUncertain, type FieldErrors, type ProfileInput } from '../presentation/form';

export function ProfileScreen() {
  const runtime = useDriverRuntime();
  const { store } = useDriverResources();
  const profile = useFocusedResource(store.profile);
  const mutation = useMutation(runtime.session);
  return (
    <Screen title="Hồ sơ tài xế" backToDriver>
      <RouteAction href="/driver/vehicles" label="Quản lý phương tiện" />
      <Busy visible={profile.loading} /><ErrorNotice error={profile.error || mutation.error} />
      {mutation.notice && <Notice tone="success">{mutation.notice}</Notice>}
      <Action label="Cập nhật hồ sơ từ máy chủ" variant="secondary" onPress={profile.refresh} disabled={profile.loading || mutation.busy} />
      {profile.data && <ProfileForm value={profile.data} onSaved={profile.replace} mutation={mutation}
        checkedAt={profile.checkedAt} loading={profile.loading} verified={!profile.loading && !profile.error} onRefresh={profile.refresh} />}
      <Action label="Đăng xuất" variant="secondary" disabled={mutation.busy} onPress={() => { void mutation.run(() => runtime.session.logout()); }} />
    </Screen>
  );
}
function ProfileForm({ value, onSaved, mutation, checkedAt, loading, verified, onRefresh }: { value: DriverProfile; onSaved: (value: DriverProfile) => void;
  mutation: ReturnType<typeof useMutation>; checkedAt: number | null; loading: boolean; verified: boolean; onRefresh: () => void }) {
  const runtime = useDriverRuntime(), { intent, active } = useDriverResources();
  const source = useMemo(() => profileInput(value), [value]);
  const { fields, change, reset } = useFormDraft(source);
  const [errors, setErrors] = useState<FieldErrors<ProfileInput>>({});
  const [uncertain, setUncertain] = useState<{ body: Partial<Pick<DriverProfile, 'fullName' | 'licenseNumber' | 'avatarUrl'>>; checkedAt: number | null } | null>(null);
  const reconciled = !!uncertain && verified && !!checkedAt && checkedAt !== uncertain.checkedAt && Object.entries(uncertain.body).every(([key, item]) => value[key as keyof DriverProfile] === item);
  const fieldErrors = { ...errors, ...serverFields(mutation.error) };
  const input = (key: keyof ProfileInput, text: string) => { change(key, text); mutation.clearError(); setErrors(previous => ({ ...previous, [key]: undefined })); };
  const save = () => {
    const invalid = validateProfile(fields);
    const name = fields.fullName.trim(), license = fields.licenseNumber.trim().toUpperCase(), avatar = fields.avatarUrl.trim() || null;
    if (license !== value.licenseNumber && (intent.error || !intent.data || intent.data.desiredStatus !== 'OFFLINE' || active.data)) invalid.licenseNumber = 'Đổi giấy phép cần tắt nhận cuốc và không có chuyến. Hãy cập nhật trạng thái trên Trang chủ.';
    setErrors(invalid); setUncertain(null);
    if (hasErrors(invalid)) return;
    const body: Partial<Pick<DriverProfile, 'fullName' | 'licenseNumber' | 'avatarUrl'>> = {};
    if (name !== value.fullName) body.fullName = name;
    if (license !== value.licenseNumber) body.licenseNumber = license;
    if (avatar !== value.avatarUrl) body.avatarUrl = avatar;
    if (!Object.keys(body).length) return;
    void mutation.run(async isCurrent => {
      try {
        const saved = await runtime.driver.updateProfile(body);
        if (isCurrent()) { onSaved(saved); reset(profileInput(saved)); }
      } catch (error) {
        if (isCurrent() && writeUncertain(error)) { setUncertain({ body, checkedAt }); onRefresh(); }
        throw error;
      }
    }, 'Đã lưu hồ sơ trên máy chủ.');
  };
  const editable = !mutation.busy && (!uncertain || reconciled);
  return <>
    <Notice>{value.phoneNumber}</Notice>
    <Notice>Số điện thoại không sửa tại đây. Đổi giấy phép cần tắt nhận cuốc và không có chuyến.</Notice>
    {(!runtime.trip.enabled || !!active.error) && <Notice>Máy chủ Driver sẽ kiểm tra chuyến và reservation khi đổi giấy phép; chưa thể xác minh điều này từ ứng dụng.</Notice>}
    {Object.keys(fields).some(key => fields[key as keyof ProfileInput] !== source[key as keyof ProfileInput]) && <Notice>Có nội dung chưa lưu. Cập nhật nền không ghi đè các trường bạn đang sửa.</Notice>}
    <Field label="Họ tên" hint="1–100 ký tự" error={fieldErrors.fullName} value={fields.fullName} onChangeText={text => input('fullName', text)} editable={editable} autoComplete="name" />
    <Field label="Giấy phép lái xe" hint="1–20 ký tự" error={fieldErrors.licenseNumber} value={fields.licenseNumber} onChangeText={text => input('licenseNumber', text)} autoCapitalize="characters" editable={editable} />
    <Field label="URL ảnh hồ sơ" hint="URL HTTPS; để trống để xóa ảnh" error={fieldErrors.avatarUrl} value={fields.avatarUrl} onChangeText={text => input('avatarUrl', text)} autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={editable} />
    {uncertain && !reconciled && <Card>
      <Notice>Chưa rõ yêu cầu lưu đã được xử lý. Nội dung được giữ lại; hãy đọc lại hồ sơ trước khi thao tác tiếp.</Notice>
      <Action label="Đọc lại để xác minh hồ sơ" variant="secondary" onPress={onRefresh} disabled={loading} />
      {verified && checkedAt !== uncertain.checkedAt && <><Notice>Hồ sơ hiện tại chưa phản ánh toàn bộ yêu cầu. Chưa có bằng chứng yêu cầu đã thất bại.</Notice><Action label="Tôi đã kiểm tra, tiếp tục chỉnh sửa" variant="secondary" onPress={() => setUncertain(null)} /></>}
    </Card>}
    {reconciled && <Notice tone="success">Hồ sơ máy chủ đã phản ánh nội dung yêu cầu.</Notice>}
    <Action label={mutation.busy ? 'Đang lưu hồ sơ…' : 'Lưu hồ sơ'} busy={mutation.busy} disabled={!editable || !Object.keys(fields).some(key => fields[key as keyof ProfileInput] !== source[key as keyof ProfileInput])} onPress={save} />
  </>;
}
