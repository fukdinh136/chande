import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useDriverRuntime, useDriverSession } from '../state/driver-provider';
import { Action, Busy, ErrorNotice, Notice, Screen } from './ui';

const labels = {
  restoring: 'Đang đọc phiên đã lưu.', authenticated: '', refreshing: 'Đang làm mới phiên đăng nhập.',
  unavailable: 'Phiên hoặc kết nối tạm thời chưa sử dụng được.',
  'refresh-uncertain': 'Chưa xác nhận được phiên đã lưu. Ứng dụng giữ thông tin phiên và dừng tự thử lại để tránh mất phiên mới.',
  'credential-error': 'Cần xử lý lưu trữ phiên trước khi tiếp tục.',
  'signed-out': '', 'reauth-required': 'Phiên đã bị từ chối. Vui lòng đăng nhập lại.',
};
export function SessionNotice() {
  const runtime = useDriverRuntime(), state = useDriverSession();
  if (state.phase === 'authenticated' && !state.error) return null;
  return <>
    {!!labels[state.phase] && <Notice>{labels[state.phase]}</Notice>}
    <Busy visible={state.phase === 'restoring' || state.phase === 'refreshing'} />
    <ErrorNotice error={state.error} />
    {state.usable && state.phase !== 'refreshing' && <Notice>Phiên hiện tại còn thời gian sử dụng. Dữ liệu có thể là lần đọc trước; thao tác chỉ thành công khi máy chủ xác nhận.</Notice>}
    {!state.usable && state.session && <Notice>Đã tạm dừng thao tác và kết nối cần đăng nhập. Hãy phục hồi phiên để tiếp tục.</Notice>}
    {state.canRecover && <RecoveryAction key={state.retryAt ?? 'ready'} deadline={state.retryAt} />}
    {!['signed-out', 'reauth-required', 'restoring'].includes(state.phase) && <Action label="Đăng nhập lại bằng OTP" variant="secondary" onPress={() => { runtime.session.chooseOtpLogin(); router.replace('/driver/login'); }} />}
  </>;
}
function RecoveryAction({ deadline }: { deadline: number | null }) {
  const runtime = useDriverRuntime();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (deadline === null) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  const wait = deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000));
  return <Action label={wait ? `Chờ máy chủ ${wait}s` : 'Thử phục hồi / lưu lại phiên'} disabled={wait > 0} onPress={() => { void runtime.session.recover(); }} />;
}
export function SessionRecoveryScreen() {
  const runtime = useDriverRuntime();
  return <Screen title="Phục hồi phiên tài xế">
    <SessionNotice />
    <Notice>Quyết định nhận cuốc và thao tác chuyến đang chờ vẫn được giữ. Sau phục hồi, ứng dụng kiểm tra lại máy chủ và không tự gửi lại các thao tác này.</Notice>
    <Action label="Đăng xuất và xóa phiên đã lưu" variant="secondary" onPress={() => { void runtime.session.logout(); }} />
  </Screen>;
}
