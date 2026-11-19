import {useCallback} from 'react';
import {useFocusEffect} from 'expo-router';
import {View} from 'react-native';
import {ThemedText} from '@/components/themed-text';
import {Screen, Action, Busy, Card, Notice} from '../ui/components';
import {CustomerHistoryCard} from './history-card';
import {useBooking} from './booking-provider';
import type {HistoryFilter} from './booking-store';

const filters: {value: HistoryFilter; label: string}[] = [{value: 'ALL', label: 'Tất cả'}, {value: 'COMPLETED', label: 'Hoàn thành'}, {value: 'CANCELLED', label: 'Đã hủy'}];

export function CustomerHistory() {
  const {store, state} = useBooking(), history = state.history;
  useFocusEffect(useCallback(() => {void store.loadHistory();}, [store]));
  return <Screen title="Lịch sử chuyến đi">
    <Notice>Những hành trình của bạn, trong một nơi.</Notice>
    <View accessibilityRole="tablist" style={{gap: 8}}>{filters.map(filter => <Action key={filter.value} role="tab" selected={history.filter === filter.value} label={`${history.filter === filter.value ? 'Đang chọn · ' : ''}${filter.label}`} variant={history.filter === filter.value ? 'primary' : 'secondary'} onPress={() => store.setHistoryFilter(filter.value)}/>)}</View>
    <Notice>Bộ lọc áp dụng cho lịch sử trên máy chủ. Mỗi lần tải tối đa 20 chuyến; chọn xem thêm để đọc trang tiếp theo.</Notice>
    <Action label="Làm mới lịch sử" variant="secondary" disabled={history.loading} onPress={() => {void store.loadHistory();}}/>
    <Busy visible={history.loading}/>
    {history.loading && <Notice>{history.more ? 'Đang tải thêm hành trình…' : history.loaded ? 'Đang cập nhật lịch sử…' : 'Đang tải lịch sử của bạn…'}</Notice>}
    {!!history.error && <Card><Notice tone="error">{history.error} {history.items.length ? 'Các chuyến đã tải vẫn được giữ.' : 'Chưa xác định được lịch sử, hãy thử lại.'}</Notice><Action label={history.failedMore ? 'Thử tải thêm lần nữa' : 'Thử tải lại lịch sử'} disabled={history.loading} onPress={() => {void store.loadHistory(history.failedMore);}}/></Card>}
    {history.loaded && !history.loading && !history.error && !history.items.length && <Card><ThemedText>{history.cursor ? 'Trang đã tải chưa có chuyến. Bạn có thể xem trang tiếp theo.' : history.filter === 'COMPLETED' ? 'Bạn chưa có chuyến hoàn thành.' : history.filter === 'CANCELLED' ? 'Bạn chưa có chuyến đã hủy.' : 'Bạn chưa có chuyến nào trong lịch sử.'}</ThemedText><Notice>Chuyến hoàn thành và chuyến đã hủy sẽ hiện ở đây.</Notice></Card>}
    {history.items.map(item => <CustomerHistoryCard key={item.tripId} trip={item}/>)}
    {history.cursor && !history.failedMore && <Action label="Xem thêm chuyến" variant="secondary" disabled={history.loading} onPress={() => {void store.loadHistory(true);}}/>}
    {history.loaded && history.items.length > 0 && !history.cursor && !history.error && <Notice>Đã tải hết lịch sử của bộ lọc này.</Notice>}
  </Screen>;
}
