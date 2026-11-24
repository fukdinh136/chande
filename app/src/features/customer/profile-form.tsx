import {useState} from 'react';
import {Action, Card, Field, Notice} from '../ui/components';
import {Avatar} from '../ui/avatar';
import {useCustomer, useCustomerSession} from './provider';
import {useOwnedForm} from './use-owned-form';
import {validateProfile} from './account-form';

export function CustomerProfileForm() {
  const runtime = useCustomer(), profile = useCustomerSession().session!.profile;
  const [name, setName] = useState(profile.fullName), [avatar, setAvatar] = useState(profile.avatarUrl ?? '');
  const form = useOwnedForm();
  return <Card>
    <Avatar name={profile.fullName} url={profile.avatarUrl}/><Notice>{profile.phoneNumber}</Notice>
    <Field label="Họ tên" value={name} onChangeText={setName} editable={!form.busy} error={form.errors.fullName} autoCapitalize="words" autoComplete="name"/>
    <Field label="URL ảnh đại diện" value={avatar} onChangeText={setAvatar} editable={!form.busy} error={form.errors.avatarUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" hint="Nhập URL http:// hoặc https://, tối đa 500 ký tự. API chưa hỗ trợ xóa ảnh đã lưu."/>
    {!!form.message && <Notice tone={form.failed ? 'error' : 'success'}>{form.message}</Notice>}
    <Action label="Lưu hồ sơ" busy={form.busy} onPress={() => {
      const errors = validateProfile(name, avatar, profile.avatarUrl); form.setErrors(errors);
      if (Object.keys(errors).length) return;
      void form.run(signal => runtime.session.saveProfile({fullName: name.trim(), ...(avatar.trim() ? {avatarUrl: avatar.trim()} : {})}, signal), saved => {setName(saved.fullName); setAvatar(saved.avatarUrl ?? ''); form.setMessage('Hồ sơ đã được lưu.');});
    }}/>
  </Card>;
}
