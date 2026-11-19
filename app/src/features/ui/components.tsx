import { type PropsWithChildren } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {Logo,palette} from './design';
import {SafeAreaView} from 'react-native-safe-area-context';

export function Screen({ title, children, driver = false, embedded = false, modal = false }: PropsWithChildren<{ title: string; driver?: boolean; embedded?: boolean; modal?: boolean }>) {
  const theme = useTheme();
  return <SafeAreaView edges={modal ? ['bottom','left','right'] : embedded ? [] : ['top','bottom','left','right']} style={{flex:1,backgroundColor:theme.background}}>
    <ScrollView style={{flex:1}} contentContainerStyle={uiStyles.screen} keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} automaticallyAdjustKeyboardInsets contentInsetAdjustmentBehavior="never">
      <View style={uiStyles.content}>
        <View style={{alignSelf:'flex-start',padding:8,borderRadius:16,backgroundColor:palette.card}}><Logo driver={driver}/></View>
        <ThemedText type="subtitle" accessibilityRole="header">{title}</ThemedText>
        {children}
      </View>
    </ScrollView>
  </SafeAreaView>;
}
export function Card({ children }: PropsWithChildren) {
  return <ThemedView type="backgroundElement" style={uiStyles.card}>{children}</ThemedView>;
}
export function Notice({ children, tone = 'neutral' }: PropsWithChildren<{ tone?: 'neutral' | 'error' | 'success' }>) {
  return <ThemedText type="small" themeColor={tone === 'neutral' ? 'textSecondary' : 'text'} accessibilityLiveRegion={tone === 'neutral' ? 'none' : 'polite'}>{tone === 'error' ? 'Lỗi: ' : tone === 'success' ? 'Đã xác nhận: ' : ''}{children}</ThemedText>;
}
export function Busy({ visible }: { visible: boolean }) {
  const theme = useTheme();
  return visible ? <ActivityIndicator accessibilityLabel="Đang tải" color={theme.text} /> : null;
}
export function Action({ label, onPress, disabled = false, busy = false, variant='primary', role='button', selected }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; variant?:'primary'|'secondary'|'danger'; role?: 'button' | 'tab'; selected?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole={role} accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy, busy, ...(selected === undefined ? {} : {selected}) }} disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [uiStyles.button, { borderColor: variant==='secondary'?palette.line:variant==='danger'?palette.danger:palette.primary, backgroundColor:variant==='secondary'?theme.backgroundElement:variant==='danger'?palette.danger:palette.primary, opacity: disabled || busy ? 0.55 : pressed ? 0.7 : 1 }]}>
      <ThemedText type="smallBold" style={{color:variant==='secondary'?theme.text:'white',fontFamily:'Inter_600SemiBold',textAlign:'center'}}>{label}</ThemedText>
    </Pressable>
  );
}
export function Field({ label, error, hint, ...props }: TextInputProps & { label: string; error?: string; hint?: string }) {
  const theme = useTheme();
  return (
    <View style={uiStyles.field}>
      <ThemedText type="small">{label}</ThemedText>
      <TextInput {...props} accessibilityLabel={label} accessibilityHint={error ? `Lỗi: ${error}` : hint} accessibilityState={{ disabled: props.editable === false }} placeholderTextColor={theme.textSecondary}
        style={[uiStyles.input, { color: theme.text, borderColor: error ? palette.danger : theme.textSecondary, backgroundColor: theme.background }, props.multiline && { textAlignVertical: 'top', minHeight: 100 }, props.style]} />
      {error ? <Notice tone="error">{error}</Notice> : hint ? <Notice>{hint}</Notice> : null}
    </View>
  );
}
export const uiStyles = StyleSheet.create({
  screen: { flexGrow: 1, padding: Spacing.three, paddingBottom: Spacing.five },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Spacing.three },
  card: { padding: Spacing.three, borderRadius: 20, gap: 12,borderWidth:1,borderColor:palette.line },
  button: { borderWidth: 1, borderRadius: 28, padding: Spacing.three, minHeight:56,justifyContent:'center',alignItems: 'center' },
  field: { gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: 18, padding: Spacing.three, minHeight:54,fontSize: 16,fontFamily:'Inter_400Regular' },
});
