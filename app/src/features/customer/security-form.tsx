import {useState} from 'react';
import {Action, Card, Field, Notice} from '../ui/components';
import {useCustomer} from './provider';
import {useOwnedForm} from './use-owned-form';
import {validatePassword} from './account-form';

export function CustomerSecurityForm() {
  const runtime = useCustomer(), form = useOwnedForm();
  const [oldPassword, setOldPassword] = useState(''), [newPassword, setNewPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [visible, setVisible] = useState(false);
  return <Card>
    <Notice>Mật khẩu mới từ 8–72 ký tự, có chữ và số. Sau khi đổi thành công, các phiên được thu hồi và bạn cần đăng nhập lại.</Notice>
    <Field label="Mật khẩu hiện tại" value={oldPassword} onChangeText={setOldPassword} secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false} autoComplete="current-password" editable={!form.busy} error={form.errors.oldPassword}/>
    <Field label="Mật khẩu mới" value={newPassword} onChangeText={setNewPassword} secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" editable={!form.busy} error={form.errors.newPassword}/>
    <Field label="Xác nhận mật khẩu mới" value={confirmation} onChangeText={setConfirmation} secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false} editable={!form.busy} error={form.errors.confirmation}/>
    <Action label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} variant="secondary" disabled={form.busy} onPress={() => setVisible(value => !value)}/>
    {!!form.message && <Notice tone="error">{form.message}</Notice>}
    <Action label="Lưu mật khẩu và đăng nhập lại" busy={form.busy} onPress={() => {
      const errors = validatePassword(oldPassword, newPassword, confirmation); form.setErrors(errors);
      if (Object.keys(errors).length) return;
      void form.run(signal => runtime.session.changePassword(oldPassword, newPassword, signal), () => {setOldPassword(''); setNewPassword(''); setConfirmation('');});
    }}/>
  </Card>;
}
