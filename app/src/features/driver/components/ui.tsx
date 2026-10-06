import type { PropsWithChildren } from 'react';
import { Link } from 'expo-router';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorText } from '../http/errors';
import {Logo,palette} from '../../ui/design';
import {SafeAreaView} from 'react-native-safe-area-context';
import {KeyboardAvoidingView} from 'react-native';

export function Screen({ title, children, backToDriver = false }: PropsWithChildren<{ title: string; backToDriver?: boolean }>) {
  const theme = useTheme();
  return (
    <SafeAreaView edges={['top','left','right']} style={{flex:1,backgroundColor:theme.background}}><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}><ScrollView style={{ flex: 1, backgroundColor: theme.background }} contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <View style={styles.content}>
        <Logo driver={title.toLowerCase().includes('tài xế')}/><ThemedText type="subtitle">{title}</ThemedText>
        {backToDriver && <Link href="/driver"><ThemedText type="linkPrimary">Về màn hình Driver</ThemedText></Link>}
        {children}
      </View>
    </ScrollView></KeyboardAvoidingView></SafeAreaView>
  );
}
export function Card({ children }: PropsWithChildren) {
  return <ThemedView type="backgroundElement" style={styles.card}>{children}</ThemedView>;
}
export function Notice({ children }: PropsWithChildren) {
  return <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">{children}</ThemedText>;
}
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? <Notice>{errorText(error)}</Notice> : null;
}
export function Busy({ visible }: { visible: boolean }) {
  const theme = useTheme();
  return visible ? <ActivityIndicator accessibilityLabel="Đang tải" color={theme.text} /> : null;
}
export function Action({ label, onPress, disabled = false,variant='primary' }: { label: string; onPress: () => void; disabled?: boolean;variant?:'primary'|'secondary'|'danger' }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.button, { borderColor: variant==='secondary'?palette.line:variant==='danger'?palette.danger:palette.primary, backgroundColor:variant==='secondary'?palette.card:variant==='danger'?palette.danger:palette.primary, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}>
      <ThemedText type="smallBold" style={{color:variant==='secondary'?theme.text:'white',fontFamily:'Inter_600SemiBold'}}>{label}</ThemedText>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="small">{label}</ThemedText>
      <TextInput {...props} accessibilityLabel={label} placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, borderColor: theme.textSecondary, backgroundColor: theme.background }, props.style]} />
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { padding: Spacing.three, paddingTop: Platform.OS === 'web' ? Spacing.six : Spacing.three, paddingBottom: BottomTabInset + Spacing.five },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Spacing.three },
  card: { padding: Spacing.three, borderRadius: 20, gap: 12,borderWidth:1,borderColor:palette.line },
  button: { borderWidth: 1, borderRadius: 28, padding: Spacing.three, minHeight:56,justifyContent:'center',alignItems: 'center' },
  field: { gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: 18, padding: Spacing.three, minHeight:54,fontSize: 16,fontFamily:'Inter_400Regular' },
});
