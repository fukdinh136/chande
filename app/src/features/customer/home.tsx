import {useCallback, useEffect, useState} from 'react';
import {KeyboardAvoidingView, Platform, StyleSheet, View, useWindowDimensions} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {useFocusEffect} from 'expo-router';
import {ThemedText} from '@/components/themed-text';
import {Logo, palette} from '../ui/design';
import {RideMap} from '../map/ride-map';
import {useCustomerSession} from './provider';
import {useBooking} from './booking-provider';
import {BookingSheet} from './booking-sheet';
import {CustomerTripLifecycle} from './trip-lifecycle';
import {tripPresentation} from './trip-policy';

export function CustomerHome() {
  const {store, state, locked} = useBooking(), session = useCustomerSession();
  const dimensions = useWindowDimensions(), [availableHeight, setAvailableHeight] = useState(0);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {if(!state.foreground)return;const timer = setInterval(() => {store.checkQuote(); setNow(Date.now());}, 1000); return () => clearInterval(timer);}, [store,state.foreground]);
  useFocusEffect(useCallback(() => () => store.cancelLocation(), [store]));
  const active = state.current, candidate = !active ? state.candidate : null;
  const pickup = active ? active.pickup : state.draft.pickup ?? undefined, destination = active ? active.destination : state.draft.destination ?? undefined;
  const fitKey = `customer/${pickup?.lat},${pickup?.lng}/${destination?.lat},${destination?.lng}/${candidate?.point.lat},${candidate?.point.lng}`;
  const changeExpanded = useCallback((expanded: boolean) => store.setSheet(expanded ? 'expanded' : 'collapsed'), [store]);
  return <GestureHandlerRootView style={styles.root}><SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
    <View style={styles.header}><Logo compact={dimensions.fontScale > 1.3 || dimensions.width < 360 || dimensions.height < 700}/><View style={{flex: 1, minWidth: 0}}><ThemedText type="smallBold" numberOfLines={2}>Xin chào {session.session?.profile.fullName}</ThemedText><ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{state.current ? tripPresentation(state.current).title : 'Bạn muốn đi đâu?'}</ThemedText></View></View>
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.root} onLayout={event => setAvailableHeight(event.nativeEvent.layout.height)}>
        <View style={{flex: 1, minHeight: 1}}>
          <RideMap reportTileErrors fill fitKey={fitKey} pickup={pickup} destination={destination} candidate={candidate?.point} candidateKind={candidate?.kind}
            pickupLabel={!active?state.pointLabels.pickup??undefined:undefined} destinationLabel={!active?state.pointLabels.destination??undefined:undefined}
            candidateLabel={candidate?.label} line={state.line} selectionLabel={!active && state.editing ? `Chọn ${state.selecting === 'pickup' ? 'điểm đón' : 'điểm đến'} trên bản đồ` : undefined}
            onSelect={!locked && state.editing ? point => {store.proposePoint(point);} : undefined}/>
        </View>
        <BookingSheet availableHeight={availableHeight || dimensions.height * 0.75} expanded={state.sheet === 'expanded'} onExpanded={changeExpanded}>
          <CustomerTripLifecycle now={now}/>
        </BookingSheet>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView></GestureHandlerRootView>;
}
const styles = StyleSheet.create({root: {flex: 1, backgroundColor: palette.surface}, header: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10}});
