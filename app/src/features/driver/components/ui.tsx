import { useContext, type PropsWithChildren } from 'react';
import { DriverShellContext } from './shell-context';
import { Link, router } from 'expo-router';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorText } from '../http/errors';
import {Logo,palette} from '../../ui/design';
import {SafeAreaView} from 'react-native-safe-area-context';

export function Screen({ title, children, backToDriver = false, modal = false }: PropsWithChildren<{ title: string; backToDriver?: boolean; modal?: boolean }>) {
  const theme = useTheme();
  const inShell = useContext(DriverShellContext);
  return (
    <SafeAreaView edges={modal ? ['bottom','left','right'] : inShell ? [] : ['top','bottom','left','right']} style={{flex:1,backgroundColor:theme.background}}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="never">
      <View style={styles.content}>
        <View style={{alignSelf:'flex-start',padding:8,borderRadius:16,backgroundColor:palette.card}}><Logo driver/></View>
        <ThemedText type="subtitle" accessibilityRole="header">{title}</ThemedText>
        {backToDriver && <Action variant="secondary" label={modal ? 'Xem lời mời trên toàn màn hình' : 'Về trang chủ tài xế'} onPress={() => router.replace(modal ? '/driver/offers' : '/driver')} />}
        {children}
      </View>
    </ScrollView></SafeAreaView>
  );
}
export function Card({ children }: PropsWithChildren) {
  return <ThemedView type="backgroundElement" style={styles.card}>{children}</ThemedView>;
}
export function Notice({ children, tone = 'neutral' }: PropsWithChildren<{ tone?: 'neutral' | 'error' | 'success' }>) {
  return <ThemedText type="small" themeColor={tone === 'neutral' ? 'textSecondary' : 'text'} accessibilityLiveRegion={tone === 'neutral' ? 'none' : 'polite'}>{tone === 'error' ? 'Lỗi: ' : tone === 'success' ? 'Đã xác nhận: ' : ''}{children}</ThemedText>;
}
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? <Notice tone="error">{errorText(error)}</Notice> : null;
}
export function Busy({ visible }: { visible: boolean }) {
  const theme = useTheme();
  return visible ? <ActivityIndicator accessibilityLabel="Đang tải" color={theme.text} /> : null;
}
export function Action({ label, onPress, disabled = false, busy = false, variant='primary' }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; variant?:'primary'|'secondary'|'danger' }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [styles.button, { borderColor: variant==='secondary'?palette.line:variant==='danger'?palette.danger:palette.primary, backgroundColor:variant==='secondary'?theme.backgroundElement:variant==='danger'?palette.danger:palette.primary, opacity: disabled || busy ? 0.55 : pressed ? 0.7 : 1 }]}>
      <ThemedText type="smallBold" style={{color:variant==='secondary'?theme.text:'white',fontFamily:'Inter_600SemiBold',textAlign:'center'}}>{label}</ThemedText>
    </Pressable>
  );
}
export function Field({ label, error, hint, ...props }: TextInputProps & { label: string; error?: string; hint?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="small">{label}</ThemedText>
      <TextInput {...props} accessibilityLabel={label} accessibilityHint={error ? `Lỗi: ${error}` : hint} accessibilityState={{ disabled: props.editable === false }} placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, borderColor: error ? palette.danger : theme.textSecondary, backgroundColor: theme.background }, props.multiline && { textAlignVertical: 'top', minHeight: 100 }, props.style]} />
      {error ? <Notice tone="error">{error}</Notice> : hint ? <Notice>{hint}</Notice> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: Spacing.three, paddingBottom: Spacing.five },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Spacing.three },
  card: { padding: Spacing.three, borderRadius: 20, gap: 12,borderWidth:1,borderColor:palette.line },
  button: { borderWidth: 1, borderRadius: 28, padding: Spacing.three, minHeight:56,justifyContent:'center',alignItems: 'center' },
  field: { gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: 18, padding: Spacing.three, minHeight:54,fontSize: 16,fontFamily:'Inter_400Regular' },
});

export function RouteAction({ href, label }: { href: '/driver/trip' | '/driver/offers' | '/driver/vehicles' | '/driver/profile' | '/driver/history'; label: string }) {
  const theme = useTheme();
  return <Link href={href} asChild><Pressable accessibilityRole="button" accessibilityLabel={label} style={StyleSheet.flatten([styles.button,{borderColor:palette.line,backgroundColor:theme.backgroundElement}])}><ThemedText type="smallBold" style={{textAlign:'center'}}>{label}</ThemedText></Pressable></Link>;
}
