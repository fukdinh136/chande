import { router } from 'expo-router';
import type { PropsWithChildren, ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader, Avatar, colors, shadows, space } from '@/design';
import { useRider } from '../provider';
import { useStore } from '../store';

export function ProfileAvatar() {
  const { account } = useRider();
  const { profile } = useStore(account);
  return <Avatar name={profile?.fullName} uri={profile?.avatarUrl} />;
}

/** Khung màn hình phụ: header Velox, nội dung cuộn, chân trang cố định (CTA) có đệm vùng an toàn. */
export function RiderScreen({ title, back = true, footer, scroll = true, children }: PropsWithChildren<{
  title: string; back?: boolean; footer?: ReactNode; scroll?: boolean;
}>) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <AppHeader title={title} onBack={back ? () => (router.canGoBack() ? router.back() : router.replace('/')) : undefined} right={<ProfileAvatar />} />
      {scroll ? (
        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      ) : <View style={styles.flex}>{children}</View>}
      {footer ? <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.gutter) }]}>{footer}</View> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { padding: space.gutter, gap: space.md, paddingBottom: space.xl },
  footer: { paddingHorizontal: space.gutter, paddingTop: space.md, backgroundColor: colors.surface, boxShadow: shadows.sheet, gap: space.sm },
});
