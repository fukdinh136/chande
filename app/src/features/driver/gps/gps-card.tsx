import { useState, useSyncExternalStore } from 'react';
import { View, Switch, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Action, Card, Notice } from '../components/ui';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useDriverRuntime, useDriverSession } from '../state/driver-provider';
import { useDriverGps } from './use-driver-gps';
import { gpsExplanation } from './location-policy';
import type { DesiredStatus } from '../contracts/models';
import { palette } from '../../ui/design';
import type { GpsState } from './gps-session';
import type { DriverRuntime } from '../state/runtime';

function gpsMessage(gps: GpsState, runtime: DriverRuntime) {
  const { requested, publishing } = gps, limits = runtime.gps.limits;
  let message = 'GPS chưa bật.';
  if (requested) {
    if (!gps.foreground) message = 'App đang tạm dừng định vị. GPS chỉ hoạt động khi app ở foreground.';
    else if (!limits) message = 'Cấu hình ngưỡng GPS chưa hợp lệ. Hãy kiểm tra cấu hình ứng dụng.';
    else if (gps.permission === 'checking') message = 'Đang kiểm tra quyền vị trí…';
    else if (gps.permission === 'denied') message = 'Chưa cấp hoặc đã mất quyền vị trí. Hãy cấp quyền rồi thử lại.';
    else if (gps.permission === 'blocked') message = 'Quyền vị trí bị chặn. Bật quyền trong Cài đặt của thiết bị rồi thử lại.';
    else if (gps.services === 'disabled') message = 'Định vị hệ thống đang tắt. Hãy bật định vị rồi thử lại.';
    else if (gps.watcher === 'error') message = gpsExplanation[gps.error ?? 'LOCATION_ERROR'] ?? gpsExplanation.LOCATION_ERROR;
    else if (gps.watcher !== 'active') message = 'Định vị đang tạm dừng hoặc khởi tạo.';
    else if (gps.issue) message = gpsExplanation[gps.issue] ?? 'Chưa có mẫu GPS hợp lệ.';
    else if (!runtime.capabilities.realtime.configured) message = 'GPS đang phục vụ bản đồ; chưa cấu hình gửi vị trí tới Realtime.';
    else if (!publishing) message = 'GPS đang phục vụ bản đồ; chưa gửi vị trí nhận chuyến.';
    else if (gps.connection === 'auth-error') message = gpsExplanation[gps.error ?? 'UNAUTHENTICATED'] ?? gpsExplanation.UNAUTHENTICATED;
    else if (gps.connection !== 'connected') message = gps.connection === 'connecting' ? 'Đang kết nối gửi GPS…' : 'Mất kết nối gửi GPS. Đang chờ kết nối lại.';
    else if (gps.sending) message = 'Đang gửi vị trí; chờ máy chủ xác nhận.';
    else if (gps.error) message = gpsExplanation[gps.error] ?? 'Chưa gửi được GPS. Hãy thử lại.';
    else if (gps.acceptedFresh) message = 'GPS đang cập nhật; mẫu gần nhất đã được máy chủ chấp nhận.';
    else message = gps.accepted && gps.acceptedAgeSeconds !== null && gps.acceptedAgeSeconds * 1000 >= limits.freshnessMs
      ? 'Vị trí máy chủ đã chấp nhận hiện đã cũ. Đang chờ mẫu mới.' : 'Đã kết nối; đang chờ xác nhận mẫu mới của lần bật GPS này.';
  }
  return message;
}
function gpsSummary(gps: GpsState) {
  if (!gps.requested) return 'GPS đang tắt';
  if (!gps.foreground) return 'GPS tạm dừng';
  if (gps.permission === 'denied' || gps.permission === 'blocked') return 'GPS cần cấp quyền';
  if (gps.services === 'disabled') return 'Định vị hệ thống đang tắt';
  if (gps.issue === 'LOW_ACCURACY') return 'GPS chưa đủ chính xác';
  if (gps.issue === 'LOCATION_STALE') return 'Vị trí GPS đã cũ';
  if (gps.watcher === 'error') return 'GPS chưa lấy được vị trí';
  if (gps.watcher === 'paused') return 'GPS tạm dừng';
  if (gps.issue || gps.watcher !== 'active') return 'Đang tìm vị trí GPS';
  if (gps.connection === 'unconfigured') return 'GPS chưa cấu hình gửi vị trí';
  if (gps.error || (gps.publishing && gps.connection !== 'connected')) return 'GPS cần kiểm tra kết nối';
  if (!gps.publishing) return 'GPS dùng cho bản đồ';
  if (gps.sending) return 'GPS đang gửi vị trí';
  return gps.acceptedFresh ? 'GPS đang cập nhật' : 'GPS chờ máy chủ xác nhận';
}
// Only this shell component activates lifecycle. Details below are a read-only subscriber.
export function GpsCard({ desiredStatus, selectedVehicleId, activeTrip = false, statusUncertain = false }: { desiredStatus?: DesiredStatus; selectedVehicleId?: string | null; activeTrip?: boolean; statusUncertain?: boolean }) {
  const runtime = useDriverRuntime(), session = useDriverSession(), theme = useTheme();
  const owner = runtime.session.getOwnerEpoch();
  const publishing = !!session.session && ((desiredStatus === 'ONLINE' && !!selectedVehicleId) || activeTrip);
  const gps = useDriverGps(runtime.gps, publishing);
  return <View style={{ paddingHorizontal: 16, paddingVertical: 4, backgroundColor: theme.backgroundElement, borderBottomWidth: 1, borderColor: palette.line }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${gpsSummary(gps)}. Xem chi tiết GPS trên trang chủ`} onPress={() => router.replace('/driver')} style={{ flex: 1, minHeight: 48, justifyContent: 'center' }}>
        <ThemedText type="smallBold">{gpsSummary(gps)}</ThemedText>
        {statusUncertain && <Notice>Trạng thái chuyến cần kiểm tra lại</Notice>}
      </Pressable>
      <View style={{ minHeight: 48, minWidth: 48, justifyContent: 'center' }}><Switch accessibilityLabel="Bật GPS khi dùng ứng dụng" value={gps.requested} onValueChange={value => { if (owner === runtime.session.getOwnerEpoch()) gps.setRequested(value); }} trackColor={{ true: palette.primary, false: '#cad8d4' }} /></View>
    </View>
  </View>;
}
export function GpsDetails() {
  const runtime = useDriverRuntime(), [details, setDetails] = useState(false);
  const gps = useSyncExternalStore(runtime.gps.subscribe, runtime.gps.getSnapshot, runtime.gps.getSnapshot);
  const needsAction = gps.permission === 'denied' || gps.permission === 'blocked' || gps.services === 'disabled' || gps.watcher === 'error' || !!gps.error;
  return <Card>
    <ThemedText type="smallBold" accessibilityRole="header">Vị trí GPS</ThemedText>
    <Notice>{gpsMessage(gps, runtime)}</Notice>
    {!gps.requested && <Action label="Bật GPS khi dùng ứng dụng" onPress={() => runtime.gps.setRequested(true)} />}
    {gps.requested && gps.foreground && needsAction && <Action label={gps.permission === 'denied' ? 'Cấp quyền và thử lại GPS' : 'Thử lại GPS'} variant="secondary" onPress={runtime.gps.retry} />}
    <Action label={details ? 'Ẩn chi tiết GPS' : 'Chi tiết GPS và kết nối'} variant="secondary" onPress={() => setDetails(value => !value)} />
    {details && <>
      <Notice>GPS chỉ cập nhật khi ứng dụng ở phía trước màn hình.</Notice>
      {!runtime.capabilities.realtime.configured && <Notice>{runtime.capabilities.realtime.reason}</Notice>}
      {!gps.publishing && <Notice>Chọn xe và bật nhận cuốc, hoặc có chuyến đang chạy, để gửi vị trí. Tắt nhận cuốc không dừng GPS của chuyến đang chạy.</Notice>}
      {gps.foreground && gps.watcher === 'active' && gps.sample && <Notice>Mẫu đo: {gps.sampleAgeSeconds ?? '?'} giây trước · độ chính xác {gps.sample.accuracy === null || !Number.isFinite(gps.sample.accuracy) ? 'chưa xác định' : `${Math.round(gps.sample.accuracy)} m`}.</Notice>}
      {gps.accepted && <Notice>{gps.foreground && gps.watcher === 'active' ? `Mẫu máy chủ chấp nhận: ${gps.acceptedAgeSeconds} giây tuổi.` : `Mẫu lịch sử có thời gian đo ${gps.accepted.recordedAt}; định vị đang tạm dừng.`} Việc chấp nhận GPS chưa bảo đảm có thể nhận cuốc.</Notice>}
    </>}
  </Card>;
}
