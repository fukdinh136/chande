import {useContext, type PropsWithChildren} from 'react';
import {Link, router} from 'expo-router';
import {Pressable, StyleSheet} from 'react-native';
import {ThemedText} from '@/components/themed-text';
import {useTheme} from '@/hooks/use-theme';
import {DriverShellContext} from './shell-context';
import {errorText} from '../http/errors';
import {palette} from '../../ui/design';
import {Screen as BaseScreen, Action, Notice, uiStyles as styles} from '../../ui/components';
export {Action, Busy, Card, Field, Notice} from '../../ui/components';
export function Screen({title, children, backToDriver = false, modal = false}: PropsWithChildren<{title: string; backToDriver?: boolean; modal?: boolean}>) {
  const embedded = useContext(DriverShellContext);
  return <BaseScreen title={title} driver embedded={embedded} modal={modal}>
        {backToDriver && <Action variant="secondary" label={modal ? 'Xem lời mời trên toàn màn hình' : 'Về trang chủ tài xế'} onPress={() => router.replace(modal ? '/driver/offers' : '/driver')} />}
    {children}
  </BaseScreen>;
}
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? <Notice tone="error">{errorText(error)}</Notice> : null;
}
export function RouteAction({ href, label }: { href: '/driver/trip' | '/driver/offers' | '/driver/vehicles' | '/driver/profile' | '/driver/history'; label: string }) {
  const theme = useTheme();
  return <Link href={href} asChild><Pressable accessibilityRole="button" accessibilityLabel={label} style={StyleSheet.flatten([styles.button,{borderColor:palette.line,backgroundColor:theme.backgroundElement}])}><ThemedText type="smallBold" style={{textAlign:'center'}}>{label}</ThemedText></Pressable></Link>;
}
