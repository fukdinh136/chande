import {useEffect, useMemo, type PropsWithChildren} from 'react';
import {Pressable, ScrollView, StyleSheet, View, useWindowDimensions} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Animated, {useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {scheduleOnRN} from 'react-native-worklets';
import {ThemedText} from '@/components/themed-text';
import {palette} from '../ui/design';
import {sheetSizes} from './booking-policy';

export function BookingSheet({children, availableHeight, expanded, onExpanded}: PropsWithChildren<{
  availableHeight: number; expanded: boolean; onExpanded: (expanded: boolean) => void;
}>) {
  const {fontScale} = useWindowDimensions();
  const {collapsed, expanded: opened} = sheetSizes(availableHeight, fontScale);
  const height = useSharedValue(expanded ? opened : collapsed), origin = useSharedValue(0);
  useEffect(() => {height.set(withTiming(expanded ? opened : collapsed, {duration: 220}));}, [expanded, opened, collapsed, height]);
  const style = useAnimatedStyle(() => ({height: height.get()}));
  // Only this header owns the pan. The map and content ScrollView keep their gestures.
  const pan = useMemo(() => Gesture.Pan().activeOffsetY([-8, 8]).failOffsetX([-24, 24])
    .onStart(() => {origin.set(height.get());})
    .onUpdate(event => {height.set(Math.min(opened, Math.max(collapsed, origin.get() - event.translationY)));})
    .onEnd(event => {
      const next = height.get() - event.velocityY * 0.15 > (collapsed + opened) / 2;
      height.set(withTiming(next ? opened : collapsed, {duration: 220}));
      scheduleOnRN(onExpanded, next);
    })
    .onFinalize((_, success) => {if (!success) height.set(withTiming(expanded ? opened : collapsed, {duration: 180}));}),
  [collapsed, opened, expanded, height, origin, onExpanded]);
  return <Animated.View style={[styles.sheet, style]}>
    <GestureDetector gesture={pan} touchAction="none">
      <View collapsable={false}>
        <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Thu gọn bảng đặt xe' : 'Mở rộng bảng đặt xe'}
          accessibilityHint="Có thể kéo lên hoặc xuống trên thanh này" accessibilityState={{expanded}}
          onPress={() => onExpanded(!expanded)} style={styles.handleButton}>
          <View style={styles.handle}/><ThemedText type="smallBold">{expanded ? 'Thu gọn' : 'Mở rộng'} bảng đặt xe</ThemedText>
        </Pressable>
      </View>
    </GestureDetector>
    <ScrollView style={{flex: 1}} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag" nestedScrollEnabled automaticallyAdjustKeyboardInsets>
      {children}
    </ScrollView>
  </Animated.View>;
}
const styles = StyleSheet.create({
  sheet: {flexShrink: 0, backgroundColor: palette.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: palette.line, overflow: 'hidden'},
  handleButton: {minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8},
  handle: {height: 4, width: 36, borderRadius: 4, backgroundColor: palette.line},
  content: {paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, gap: 12},
});
