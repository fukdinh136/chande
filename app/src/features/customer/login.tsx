import {useEffect, useRef, useState} from 'react';
import {Redirect} from 'expo-router';
import {View, Pressable, StyleSheet} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {ThemedText} from '@/components/themed-text';
import {ConnectionSettings} from '../backend/connection';
import {Action, Busy, Card, Field, Notice, Screen} from '../ui/components';
import {palette} from '../ui/design';
import {useCustomer, useCustomerSession} from './provider';
import {authFailure, validateAuth, type AuthErrors, type AuthValues} from './auth-form';
import {customerError} from './errors';

export function CustomerLogin() {
  const runtime = useCustomer(), state = useCustomerSession();
  const [values, setValues] = useState<AuthValues>({phoneNumber: '', password: '', fullName: ''});
  const [register, setRegister] = useState(false), [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [errors, setErrors] = useState<AuthErrors>({});
  const sending = useRef(false), mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const change = (key: keyof AuthValues, value: string) => {
    setValues(old => ({...old, [key]: value})); setErrors(old => ({...old, [key]: undefined})); setMessage('');
  };
  const submit = async () => {
    if (sending.current) return;
    const fields = validateAuth(values, register); setErrors(fields); setMessage('');
    if (Object.keys(fields).length) return;
    const epoch = runtime.session.getOwnerEpoch();
    sending.current = true; setBusy(true);
    try {
      if (register) await runtime.user.register(values.phoneNumber.trim(), values.password, values.fullName.trim());
      if (!mounted.current || epoch !== runtime.session.getOwnerEpoch()) return;
      await runtime.session.login(values.phoneNumber.trim(), values.password);
      if (mounted.current) {setValues({phoneNumber: '', password: '', fullName: ''}); setVisible(false);}
    } catch (error) {
      if (mounted.current) {const failure = authFailure(error); setErrors(failure.fields); setMessage(failure.message);}
    } finally {sending.current = false; if (mounted.current) setBusy(false);}
  };
  if (state.restoring) return <Screen title="Chào mừng đến Velox"><Busy visible/><Notice>Đang khôi phục phiên đăng nhập…</Notice></Screen>;
  if (state.session) return <Redirect href="/customer"/>;
  return <Screen title="Velox Ride">
    <ThemedText type="subtitle">Hành trình của bạn bắt đầu ở đây</ThemedText>
    <Notice>Di chuyển dễ dàng cùng Velox. Đăng nhập hoặc tạo tài khoản để đặt xe.</Notice>
    <Card>
      <View style={styles.modes}>{[false, true].map(mode => <Pressable key={String(mode)} accessibilityRole="tab" accessibilityState={{selected: register === mode, disabled: busy}} disabled={busy}
        onPress={() => {setRegister(mode); setErrors({}); setMessage(''); setVisible(false);}}
        style={[styles.mode, register === mode && styles.selected]}>
        <ThemedText type="smallBold">{mode ? 'Đăng ký' : 'Đăng nhập'}</ThemedText>
      </Pressable>)}</View>
      {!!message && <Notice tone="error">{message}</Notice>}
      {!message && !!state.error && <Notice tone="error">{customerError(state.error)}</Notice>}
      <Field label="Số điện thoại" hint="Số di động Việt Nam · 0 hoặc +84" placeholder="0912345678" value={values.phoneNumber} onChangeText={value => change('phoneNumber', value)} error={errors.phoneNumber}
        editable={!busy} keyboardType="phone-pad" autoComplete="tel" autoCapitalize="none" autoCorrect={false}/>
      {register && <Field label="Họ tên" value={values.fullName} onChangeText={value => change('fullName', value)} error={errors.fullName} editable={!busy} autoComplete="name" autoCapitalize="words"/>}
      <View style={styles.password}>
        <View style={{flex: 1}}><Field label="Mật khẩu" value={values.password} onChangeText={value => change('password', value)} error={errors.password}
          hint={register ? '8–72 ký tự, có chữ và số; tối đa 72 byte UTF-8' : undefined} editable={!busy} secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false}
          autoComplete={register ? 'new-password' : 'current-password'} returnKeyType="go" onSubmitEditing={() => {void submit();}}/></View>
        <Pressable accessibilityRole="button" accessibilityLabel={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} accessibilityState={{disabled: busy}} disabled={busy} onPress={() => setVisible(old => !old)} style={styles.eye}>
          <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={24} color={palette.primary}/>
        </Pressable>
      </View>
      <Action label={register ? 'Tạo tài khoản và đăng nhập' : 'Đăng nhập'} busy={busy} onPress={() => {void submit();}}/>
      <Busy visible={busy}/>{busy && <Notice>Đang xác nhận thông tin của bạn…</Notice>}
    </Card>
    <ConnectionSettings/>
  </Screen>;
}
const styles = StyleSheet.create({
  modes: {flexDirection: 'row', padding: 4, borderRadius: 24, backgroundColor: '#eff4ff'},
  mode: {flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 8, borderRadius: 20},
  selected: {backgroundColor: palette.card},
  password: {flexDirection: 'row', alignItems: 'center', gap: 4},
  eye: {minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center'},
});
