import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import type { OtpChallenge } from '../contracts/models';
import { ApiError } from '../http/errors';
import { useDriverRuntime, useDriverSession } from '../state/driver-provider';
import { useMutation } from '../hooks/use-mutation';
import { Action, Busy, ErrorNotice, Field, Notice, Screen } from '../components/ui';
import {ConnectionSettings} from '../../backend/connection';

export function LoginScreen() {
  const runtime = useDriverRuntime();
  const session = useDriverSession();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [challenge, setChallenge] = useState<(OtpChallenge & { phone: string; issuedAt: number }) | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const mutation = useMutation();
  useEffect(() => {
    if (!challenge) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [challenge]);
  if (session.restoring) return <Screen title="Khôi phục phiên"><Busy visible /></Screen>;
  if (session.session) return <Redirect href="/driver" />;
  const remaining = challenge ? Math.max(0, Math.ceil((challenge.issuedAt + challenge.expiresIn * 1000 - now) / 1000)) : 0;
  const cooldown = challenge ? Math.max(0, Math.ceil((challenge.issuedAt + challenge.retryAfterSeconds * 1000 - now) / 1000)) : 0;
  return (
    <Screen title="Đăng nhập tài xế">
      <Notice>Dùng số điện thoại của tài xế thử nghiệm đã được chuẩn bị. Ứng dụng không đăng ký tài khoản mới.</Notice>
      {!runtime.storage.persistent && <Notice>Trên web, phiên chỉ giữ trong bộ nhớ tab. Token không lưu vào localStorage.</Notice>}
      <ErrorNotice error={session.error} />
      <Field label="Số điện thoại (ví dụ 84912345678)" value={phone} onChangeText={(value) => { setPhone(value); setChallenge(null); setOtp(''); }} keyboardType="phone-pad" autoComplete="tel" editable={!mutation.busy} />
      <Action label={cooldown ? `Yêu cầu OTP mới sau ${cooldown}s` : 'Yêu cầu OTP'} disabled={mutation.busy || cooldown > 0}
        onPress={() => { void mutation.run(async () => {
          const canonical = phone.trim();
          if (!/^\+?[1-9]\d{8,14}$/.test(canonical)) throw new ApiError('INVALID_REQUEST');
          const value = await runtime.auth.requestOtp(canonical);
          const issuedAt = Date.now();
          setNow(issuedAt); setChallenge({ ...value, phone: canonical, issuedAt }); setOtp('');
        }); }} />
      {challenge && <>
        <Notice>Mã còn hiệu lực {remaining}s. OTP không xuất hiện trong phản hồi API.</Notice>
        <Field label="OTP sáu chữ số" value={otp} onChangeText={setOtp} keyboardType="number-pad" autoComplete="sms-otp" editable={!mutation.busy} />
        <Action label="Xác thực và đăng nhập" disabled={mutation.busy || !remaining}
          onPress={() => { void mutation.run(async () => {
            if (!/^\d{6}$/.test(otp)) throw new ApiError('INVALID_REQUEST');
            await runtime.session.login(challenge.phone, challenge.challengeId, otp);
          }); }} />
      </>}
      <Busy visible={mutation.busy} /><ErrorNotice error={mutation.error} />
      <ConnectionSettings/>
    </Screen>
  );
}
