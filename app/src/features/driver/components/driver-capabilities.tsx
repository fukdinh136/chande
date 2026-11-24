import { useState, useSyncExternalStore } from 'react';
import { ThemedText } from '@/components/themed-text';
import { useDriverRuntime } from '../state/driver-provider';
import { useDriverForeground } from '../hooks/use-driver-foreground';
import type { ConnectionState } from '../realtime/realtime-client';
import { Action, Card, Notice } from './ui';

const labels: Record<ConnectionState, string> = {
  unconfigured: 'chưa cấu hình', paused: 'tạm dừng', connecting: 'đang kết nối',
  connected: 'đã kết nối', retrying: 'mất kết nối, đang thử lại', error: 'kết nối lỗi; kiểm tra phiên/cấu hình rồi thử lại',
};
export function DriverCapabilities() {
  const runtime = useDriverRuntime();
  const [expanded, setExpanded] = useState(false);
  const foreground = useDriverForeground();
  const state = useSyncExternalStore(runtime.realtime.subscribeConnections, runtime.realtime.getConnections, runtime.realtime.getConnections);
  const unavailable = Object.entries(runtime.capabilities).filter(([, value]) => !value.configured);
  return <Card>
    <ThemedText type="smallBold">Kết nối chức năng</ThemedText>
    <Notice>{unavailable.length ? 'Một số chức năng chưa được cấu hình.' : state.offers === 'connected' && state.trips === 'connected' ? 'Thông báo chuyến đang kết nối.' : 'Kiểm tra kết nối thông báo chuyến nếu cập nhật bị chậm.'}</Notice>
    <Action label={expanded ? 'Ẩn chi tiết kết nối' : 'Xem chi tiết kết nối'} variant="secondary" onPress={() => setExpanded(value => !value)} />
    {expanded && <>
    <Notice>Trip HTTP: {runtime.capabilities.trip.configured ? 'đã cấu hình' : 'chưa cấu hình'} · Matching HTTP: {runtime.capabilities.matching.configured ? 'đã cấu hình' : 'chưa cấu hình'}</Notice>
    <Notice>Thông báo lời mời: {labels[state.offers]} · Thông báo Trip: {labels[state.trips]}</Notice>
    <Notice>GPS: {runtime.capabilities.realtime.configured ? 'đã cấu hình, bật bằng công tắc phía trên' : 'chưa cấu hình'} · Điều hướng: {runtime.capabilities.routing.configured ? 'đã cấu hình' : 'chưa cấu hình'}</Notice>
    {unavailable.map(([name, value]) => <Notice key={name}>{value.reason}</Notice>)}
    {(state.offers !== 'unconfigured' || state.trips !== 'unconfigured') && <Action label="Kết nối lại thông báo" variant="secondary" disabled={!foreground} onPress={() => { void runtime.realtime.connect(); }}/>}
    </>}
  </Card>;
}
