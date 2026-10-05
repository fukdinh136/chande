import { useCallback, useState } from 'react';
import type { DriverProfile } from '../contracts/models';
import { useDriverRuntime } from '../state/driver-provider';
import { useFocusedResource } from '../hooks/use-focused-resource';
import { useMutation } from '../hooks/use-mutation';
import { ApiError } from '../http/errors';
import { Action, Busy, ErrorNotice, Field, Notice, Screen } from '../components/ui';

export function ProfileScreen() {
  const runtime = useDriverRuntime();
  const profile = useFocusedResource(useCallback((signal: AbortSignal) => runtime.driver.profile(signal), [runtime]));
  return (
    <Screen title="Hồ sơ tài xế" backToDriver>
      <Busy visible={profile.loading} /><ErrorNotice error={profile.error} />
      <Action label="Tải lại hồ sơ" onPress={profile.refresh} disabled={profile.loading} />
      {profile.data && <ProfileForm key={profile.data.updatedAt} value={profile.data} onSaved={profile.replace} />}
    </Screen>
  );
}
function ProfileForm({ value, onSaved }: { value: DriverProfile; onSaved: (value: DriverProfile) => void }) {
  const { driver } = useDriverRuntime();
  const [fullName, setFullName] = useState(value.fullName);
  const [licenseNumber, setLicenseNumber] = useState(value.licenseNumber);
  const [avatarUrl, setAvatarUrl] = useState(value.avatarUrl ?? '');
  const mutation = useMutation();
  return <>
    <Notice>{value.phoneNumber} · {value.driverId}</Notice>
    <Notice>Đổi giấy phép cần OFFLINE và không có chuyến. Số điện thoại không sửa ở màn hình này.</Notice>
    <Field label="Họ tên (1–100 ký tự)" value={fullName} onChangeText={setFullName} editable={!mutation.busy} />
    <Field label="Giấy phép (1–20 ký tự)" value={licenseNumber} onChangeText={setLicenseNumber} autoCapitalize="characters" editable={!mutation.busy} />
    <Field label="URL ảnh HTTPS; để trống để xóa" value={avatarUrl} onChangeText={setAvatarUrl} autoCapitalize="none" keyboardType="url" editable={!mutation.busy} />
    <Action label="Lưu hồ sơ" disabled={mutation.busy} onPress={() => { void mutation.run(async () => {
      const name = fullName.trim(), license = licenseNumber.trim(), avatar = avatarUrl.trim() || null;
      const body: Partial<Pick<DriverProfile, 'fullName' | 'licenseNumber' | 'avatarUrl'>> = {};
      if (name !== value.fullName) body.fullName = name;
      if (license !== value.licenseNumber) body.licenseNumber = license;
      if (avatar !== value.avatarUrl) body.avatarUrl = avatar;
      if ((body.fullName !== undefined && (!name || name.length > 100)) || (body.licenseNumber !== undefined && (!license || license.length > 20)) || (body.avatarUrl && (body.avatarUrl.length > 2048 || !/^https:\/\//i.test(body.avatarUrl)))) throw new ApiError('INVALID_REQUEST');
      if (!Object.keys(body).length) return;
      onSaved(await driver.updateProfile(body));
    }, 'Đã lưu hồ sơ.'); }} />
    <Busy visible={mutation.busy} /><ErrorNotice error={mutation.error} />
    {mutation.notice && <Notice>{mutation.notice}</Notice>}
  </>;
}
