import { useEffect, useSyncExternalStore } from 'react';
import { Redirect } from 'expo-router';
import { useDriverRuntime, useDriverSession } from '../state/driver-provider';
import { Action, Busy, ErrorNotice, Field, Notice, Screen } from '../components/ui';
import { SessionNotice, SessionRecoveryScreen } from '../components/session-notice';
import { ConnectionSettings } from '../../backend/connection';

export function LoginScreen() {
  const runtime = useDriverRuntime(), session = useDriverSession(), manager = runtime.login;
  const form = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
  useEffect(() => manager.attach(), [manager]);
  if (session.restoring) return <Screen title="Khôi phục phiên"><Busy visible /></Screen>;
  if (session.usable) return <Redirect href="/driver" />;
  if (!['signed-out', 'reauth-required'].includes(session.phase)) return <SessionRecoveryScreen />;
  const requestWait = Math.max(form.cooldown, form.requestWait);
  return <Screen title="Đăng nhập tài xế">
    <Notice>Dùng số điện thoại đã đăng ký tài xế. Ứng dụng hiện không có chức năng đăng ký tài khoản mới.</Notice>
    {!runtime.storage.persistent && <Notice>Trên web, phiên chỉ giữ trong bộ nhớ tab. Token không lưu vào localStorage.</Notice>}
    <SessionNotice />
    <Field label="Số điện thoại (ví dụ 84912345678)" value={form.phone} onChangeText={manager.setPhone} keyboardType="phone-pad" autoComplete="tel" editable={!form.busy} />
    {form.cooldown > 0 && <Notice>Cooldown gửi lại OTP: còn {form.cooldown}s theo phản hồi tạo challenge.</Notice>}
    {form.requestWait > 0 && <Notice>Server yêu cầu chờ {form.requestWait}s trước khi yêu cầu OTP lại (Retry-After).</Notice>}
    <Action label={requestWait ? `Yêu cầu OTP sau ${requestWait}s` : 'Yêu cầu OTP'} disabled={form.busy || requestWait > 0} onPress={() => { void manager.requestOtp(); }} />
    {form.challenge && <>
      <Notice>{form.remaining ? `Mã còn hiệu lực khoảng ${form.remaining}s.` : 'Mã đã hết thời gian hiệu lực trên thiết bị; hãy yêu cầu OTP mới.'} OTP không xuất hiện trong phản hồi API.</Notice>
      <Field label="OTP sáu chữ số" value={form.otp} onChangeText={manager.setOtp} keyboardType="number-pad" autoComplete="sms-otp" editable={!form.busy} />
      {form.verifyWait > 0 && <Notice>Server yêu cầu chờ {form.verifyWait}s trước khi xác thực lại.</Notice>}
      <Action label="Xác thực và đăng nhập" disabled={form.busy || !form.remaining || form.verifyWait > 0} onPress={() => { void manager.verifyOtp(); }} />
    </>}
    <Busy visible={form.busy} /><ErrorNotice error={form.error} />
    {runtime.config.mode === 'gateway' && <ConnectionSettings />}
  </Screen>;
}
