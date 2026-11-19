import {Pressable, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {ThemedText} from '@/components/themed-text';
import {Action, Busy, Notice} from '../ui/components';
import {Chip, palette, vnd, distance, duration} from '../ui/design';
import {useBooking} from './booking-provider';
import {PointPicker} from './point-picker';

const steps = {points: '1 · Chọn điểm', vehicle: '2 · Chọn xe', price: '3 · Xem giá', confirm: '4 · Xác nhận'};
export function BookingForm({now}: {now: number}) {
  const {store, state, locked} = useBooking(), {draft, quote, flow} = state;
  const remaining = store.remainingQuoteMs(now), expired = state.quoteExpired || remaining <= 0;
  return <View style={{gap: 14}}>
    <View style={styles.steps}>{Object.entries(steps).map(([key, label]) => <View key={key} style={[styles.step, flow === key && styles.selected]}>
      <ThemedText type="smallBold">{label}</ThemedText>
    </View>)}</View>
    <View style={styles.points}>{(['pickup', 'destination'] as const).map(kind => <Pressable key={kind} accessibilityRole="button"
      accessibilityLabel={`Sửa ${kind === 'pickup' ? 'điểm đón' : 'điểm đến'}`} accessibilityState={{selected: state.editing && state.selecting === kind, disabled: locked}}
      style={[styles.point, state.editing && state.selecting === kind && styles.selected]} disabled={locked} onPress={() => store.selectKind(kind)}>
      <Ionicons name={kind === 'pickup' ? 'radio-button-on' : 'flag'} size={20} color={kind === 'pickup' ? palette.primary : palette.ink}/>
      <View style={{flex: 1, gap: 2}}><ThemedText type="smallBold">{kind === 'pickup' ? 'Điểm đón' : 'Điểm đến'}</ThemedText>
        <ThemedText>{draft[kind] ? state.pointLabels[kind] : 'Chưa xác nhận vị trí'}</ThemedText>
        <Notice>{state.editing && state.selecting === kind ? 'Đang chỉnh sửa' : draft[kind] ? 'Đã xác nhận · chạm để sửa' : 'Chạm để chọn'}</Notice>
      </View><Ionicons name="chevron-forward" size={18} color={palette.muted}/>
    </Pressable>)}</View>
    {state.editing && flow === 'points' && <PointPicker key={state.selecting}/>}
    {flow === 'points' && !state.editing && <Action label="Tiếp tục chọn xe" disabled={locked || !store.pointsReady} onPress={() => store.goTo('vehicle')}/>}
    {!state.editing && (flow === 'vehicle' || flow === 'price' || flow === 'confirm') && <>
      {flow === 'vehicle' ? <>
        <ThemedText type="subtitle">Xe phù hợp với hành trình</ThemedText>
        <View style={styles.vehicles}>{(['CAR_4', 'CAR_7'] as const).map(vehicle => <Pressable key={vehicle} accessibilityRole="radio" accessibilityState={{checked: vehicle === draft.vehicleType, disabled: locked}}
          accessibilityLabel={vehicle === 'CAR_4' ? 'Ô tô 4 chỗ' : 'Ô tô 7 chỗ'} disabled={locked} onPress={() => store.setVehicle(vehicle)}
          style={[styles.vehicle, vehicle === draft.vehicleType && styles.selected]}>
          <Ionicons name={vehicle === 'CAR_4' ? 'car-sport' : 'car'} size={32} color={palette.primary}/>
          <ThemedText type="smallBold">{vehicle === 'CAR_4' ? 'Ô tô 4 chỗ' : 'Ô tô 7 chỗ'}</ThemedText>
          <Notice>{vehicle === draft.vehicleType ? 'Đang chọn' : 'Chọn loại xe này'}</Notice>
        </Pressable>)}</View>
        <Action label="Xem giá chuyến đi" disabled={locked || !store.pointsReady} onPress={() => {void store.estimate();}}/>
        <Action label="Quay lại chọn điểm" variant="secondary" disabled={locked} onPress={() => store.goTo('points')}/>
      </> : <>
        <ThemedText type="subtitle">{flow === 'confirm' ? 'Xác nhận hành trình' : 'Giá chuyến đi'}</ThemedText>
        <Notice>{draft.vehicleType === 'CAR_4' ? 'Ô tô 4 chỗ' : 'Ô tô 7 chỗ'} · giá theo báo giá hiện tại</Notice>
        <Busy visible={state.step === 'quoting' || state.quoteChecking}/>
        {state.step === 'quoting' && <Notice>Đang lấy báo giá cho hai điểm đã xác nhận…</Notice>}
        {quote && <View style={styles.price}>
          <ThemedText type="subtitle" style={{fontVariant: ['tabular-nums']}}>{vnd(quote.amount)}</ThemedText>
          <Notice>Quãng đường: {distance(quote.distance)}</Notice>
          <Notice>Thời gian hành trình: {duration(quote.duration)}</Notice>
          <Chip tone={expired ? 'warning' : 'default'}>{state.quoteChecking ? 'Đang kiểm tra lại thời hạn…' : expired ? state.quoteProblem ? 'Báo giá cần làm mới' : 'Báo giá đã hết hạn' : `Giữ giá còn ${Math.ceil(remaining / 1000)} giây`}</Chip>
          {state.quoteProblem && <Notice>{state.quoteProblem}</Notice>}
        </View>}
        {state.step !== 'quoting' && (!quote || expired) && <Action label={quote ? 'Lấy giá mới' : 'Thử lấy báo giá'} disabled={locked || state.quoteChecking} onPress={() => {void store.estimate();}}/>}
        {quote && !expired && flow === 'price' && <Action label="Tiếp tục xác nhận" disabled={locked || !store.quoteUsable} onPress={() => store.goTo('confirm')}/>}
        {quote && !expired && flow === 'confirm' && <Action label="Xác nhận đặt xe" disabled={locked || !store.quoteUsable} onPress={() => {void store.create();}}/>}
        <Action label="Sửa loại xe" variant="secondary" disabled={locked} onPress={() => store.goTo('vehicle')}/>
      </>}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  steps: {flexDirection: 'row', flexWrap: 'wrap', gap: 6},
  step: {paddingHorizontal: 10, paddingVertical: 8, backgroundColor: palette.surface, borderRadius: 16},
  selected: {backgroundColor: palette.container, borderColor: palette.primary},
  points: {gap: 6, backgroundColor: palette.surface, borderRadius: 20, padding: 6},
  point: {flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 72, borderRadius: 16},
  vehicles: {flexDirection: 'row', flexWrap: 'wrap', gap: 12},
  vehicle: {flexGrow: 1, flexBasis: 140, minHeight: 120, padding: 16, gap: 8, borderRadius: 20, borderWidth: 2, borderColor: palette.line},
  price: {padding: 16, gap: 10, backgroundColor: palette.surface, borderRadius: 20},
});
