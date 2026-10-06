import { Link, Redirect } from 'expo-router';
import { useState, type PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, BrandMark, Card, IconButton, Loading, PrimaryButton, TextField, Txt, colors, space } from '@/design';
import { errorText, fieldError } from '../errors';
import { useRider, useRiderSession } from '../provider';

function AuthLayout({ title, subtitle, children }: PropsWithChildren<{ title: string; subtitle: string }>) {
  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <BrandMark size={56} />
            <Txt variant="label-sm" uppercase color={colors.primary}>Chande</Txt>
            <Txt variant="headline-lg-mobile" align="center">{title}</Txt>
            <Txt variant="body-md" align="center" color={colors.onSurfaceVariant}>{subtitle}</Txt>
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PasswordField({ label, value, onChangeText, error, hint, autoComplete }: {
  label: string; value: string; onChangeText: (value: string) => void; error?: string | null; hint?: string;
  autoComplete: 'password' | 'new-password' | 'current-password';
}) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField label={label} value={value} onChangeText={onChangeText} error={error} hint={hint} secureTextEntry={!visible}
      autoCapitalize="none" autoCorrect={false} autoComplete={autoComplete} maxLength={72}
      trailing={<IconButton icon={visible ? 'visibility_off' : 'visibility'} label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} variant="plain" size={40} onPress={() => setVisible(!visible)} />} />
  );
}

export function LoginScreen() {
  const { session } = useRider();
  const state = useRiderSession();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (state.status === 'restoring') return <SafeAreaView style={styles.root}><Loading label="Đang khôi phục phiên…" /></SafeAreaView>;
  if (state.status === 'signedIn') return <Redirect href="/" />;
  const canSubmit = !!phone.trim() && !!password && !busy;
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try { await session.login(phone.trim(), password); } catch (failure) { setError(failure); } finally { setBusy(false); }
  };
  return (
    <AuthLayout title="Chào mừng trở lại" subtitle="Đặt xe nhanh, an toàn trong nội thành Hà Nội.">
      {state.notice ? <Banner tone="success" message={state.notice} /> : null}
      {!state.notice && state.error ? <Banner tone="warning" message={errorText(state.error)} /> : null}
      <Card style={styles.form}>
        <TextField label="Số điện thoại" value={phone} onChangeText={setPhone} placeholder="0912 345 678" keyboardType="phone-pad"
          autoComplete="tel" textContentType="telephoneNumber" maxLength={20} error={fieldError(error, 'phoneNumber')} />
        <PasswordField label="Mật khẩu" value={password} onChangeText={setPassword} autoComplete="current-password" error={fieldError(error, 'password')} />
        {error && !fieldError(error, 'phoneNumber') && !fieldError(error, 'password') ? <Banner tone="error" message={errorText(error)} /> : null}
        <PrimaryButton label="Đăng nhập" icon="bolt" loading={busy} disabled={!canSubmit} onPress={() => { void submit(); }} />
      </Card>
      <View style={styles.links}>
        <Txt variant="body-md" color={colors.onSurfaceVariant}>Chưa có tài khoản?</Txt>
        <Link href="/register"><Txt variant="label-lg" color={colors.primary}>Đăng ký</Txt></Link>
      </View>
      <Link href="/driver" style={styles.driverLink}><Txt variant="label-md" color={colors.slateMuted}>Bạn là tài xế? Mở ứng dụng tài xế</Txt></Link>
    </AuthLayout>
  );
}

// BR-03 của User Service: 8–72 ký tự, có chữ cái Latin và chữ số.
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).+$/;

export function RegisterScreen() {
  const { session } = useRider();
  const state = useRiderSession();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);
  if (state.status === 'signedIn') return <Redirect href="/" />;
  const local = {
    fullName: !fullName.trim() ? 'Họ tên không được để trống' : fullName.length > 100 ? 'Họ tên tối đa 100 ký tự' : null,
    phoneNumber: !phone.trim() ? 'Số điện thoại không được để trống' : null,
    password: password.length < 8 || password.length > 72 ? 'Mật khẩu phải từ 8 đến 72 ký tự'
      : !PASSWORD_RULE.test(password) ? 'Mật khẩu phải có cả chữ và số' : null,
    confirm: confirm !== password ? 'Mật khẩu nhập lại chưa khớp' : null,
  };
  const valid = Object.values(local).every((item) => item === null);
  const show = (field: keyof typeof local) => (touched ? local[field] : null) ?? (field === 'confirm' ? null : fieldError(error, field));
  const submit = async () => {
    setTouched(true);
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try { await session.register(phone.trim(), password, fullName.trim()); } catch (failure) { setError(failure); } finally { setBusy(false); }
  };
  const serverError = error && !['fullName', 'phoneNumber', 'password'].some((field) => fieldError(error, field));
  return (
    <AuthLayout title="Tạo tài khoản" subtitle="Chỉ cần số điện thoại và mật khẩu để bắt đầu đặt xe.">
      <Card style={styles.form}>
        <TextField label="Họ tên" value={fullName} onChangeText={setFullName} placeholder="Nguyễn Văn A" autoComplete="name" maxLength={100} error={show('fullName')} />
        <TextField label="Số điện thoại" value={phone} onChangeText={setPhone} placeholder="0912 345 678" keyboardType="phone-pad"
          autoComplete="tel" maxLength={20} error={show('phoneNumber')} />
        <PasswordField label="Mật khẩu" value={password} onChangeText={setPassword} autoComplete="new-password" hint="8–72 ký tự, có cả chữ và số" error={show('password')} />
        <PasswordField label="Nhập lại mật khẩu" value={confirm} onChangeText={setConfirm} autoComplete="new-password" error={show('confirm')} />
        {serverError ? <Banner tone="error" message={errorText(error)} /> : null}
        <PrimaryButton label="Tạo tài khoản" icon="check" loading={busy} onPress={() => { void submit(); }} />
      </Card>
      <View style={styles.links}>
        <Txt variant="body-md" color={colors.onSurfaceVariant}>Đã có tài khoản?</Txt>
        <Link href="/login"><Txt variant="label-lg" color={colors.primary}>Đăng nhập</Txt></Link>
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { flexGrow: 1, justifyContent: 'center', padding: space.lg, gap: space.lg },
  hero: { alignItems: 'center', gap: space.sm },
  form: { gap: space.md, padding: space.lg },
  links: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.xs },
  driverLink: { alignSelf: 'center' },
});
