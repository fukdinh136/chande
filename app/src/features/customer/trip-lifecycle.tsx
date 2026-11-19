import {ThemedText} from '@/components/themed-text';
import {Action, Busy, Card, Notice} from '../ui/components';
import {useBooking} from './booking-provider';
import {BookingForm} from './booking-form';
import {ActiveTripCard} from './active-trip-card';

export function CustomerTripLifecycle({now}: {now: number}) {
  const {store, state, command} = useBooking(), result = state.commandResult;
  const pending = !!command.pending;
  return <>
    <Busy visible={state.activeLoading || state.commandsLoading || state.busy || command.busy}/>
    {!state.foreground && <Notice>Cập nhật đang tạm dừng khi ứng dụng ở nền. Velox sẽ kiểm tra lại chuyến khi bạn quay lại.</Notice>}
    {state.activeError ? <Notice tone="error">{state.activeError} {state.current ? 'Thông tin chuyến gần nhất vẫn được giữ.' : 'Chưa xác minh được bạn có chuyến hay không.'} Chưa thể gửi yêu cầu mới.</Notice> :
      state.activeLoading ? <Notice>Đang kiểm tra trạng thái chuyến mới nhất…</Notice> :
      (state.connection === 'retrying' || state.connection === 'error') && <Notice>Kết nối cập nhật trực tiếp bị gián đoạn. Velox vẫn kiểm tra chuyến định kỳ khi ứng dụng mở.</Notice>}
    {state.lastCheckedAt !== null && <Notice>Cập nhật gần nhất: {new Date(state.lastCheckedAt).toLocaleTimeString('vi-VN')}</Notice>}
    {state.error && <Notice tone="error">{state.error}</Notice>}
    {state.previewError && <Notice>{state.previewError}</Notice>}
    {state.current ? <ActiveTripCard/> : pending || state.busy || command.busy ? <Card>
      <ThemedText type="subtitle">{pending ? 'Đang xác minh yêu cầu trước đó' : 'Đang xử lý yêu cầu của bạn'}</ThemedText>
      <Notice>Velox chưa mở lượt đặt mới cho đến khi xác minh xong chuyến và thao tác hiện tại.</Notice>
    </Card> : !state.checked || !command.ready ? <Card>
      <ThemedText type="smallBold">Kiểm tra chuyến và thao tác trước đó</ThemedText>
      <Notice>{state.activeError || state.error ? 'Chưa thể xác minh. Hãy kiểm tra kết nối rồi thử lại.' : 'Vui lòng chờ Velox khôi phục thông tin trước khi đặt xe.'}</Notice>
    </Card> : <BookingForm now={now}/>}
    {result && <Notice tone={result.phase === 'rejected' ? 'error' : result.phase === 'confirmed' ? 'success' : 'neutral'}>{result.message}</Notice>}
    {pending && <Card>
      <ThemedText type="smallBold">{command.pending?.operation === 'cancel' ? 'Yêu cầu hủy chưa rõ kết quả' : 'Yêu cầu đặt xe chưa rõ kết quả'}</ThemedText>
      <Notice>Thao tác đã được lưu. Thử lại sẽ dùng đúng yêu cầu trước, không tạo một yêu cầu đặt hoặc hủy khác.</Notice>
      <Action label="Kiểm tra và thử lại yêu cầu đã lưu" disabled={!state.foreground || state.busy || command.busy || !command.ready} onPress={() => {void store.retryCommand();}}/>
    </Card>}
    <Action label={!state.checked || !command.ready ? 'Thử kiểm tra lại' : 'Cập nhật chuyến'} variant="secondary" disabled={!state.foreground || state.activeLoading || state.commandsLoading || state.busy || command.busy} onPress={() => {void store.retryRecovery();}}/>
  </>;
}
