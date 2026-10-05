import { useCallback, useState } from 'react';
import { Action, Card, Notice } from '../components/ui';
import { useDriverRuntime, useDriverSession } from '../state/driver-provider';
import { useDriverGps } from './use-driver-gps';
import type { DesiredStatus } from '../contracts/models';
export function GpsCard({ desiredStatus, selectedVehicleId }: { desiredStatus?: DesiredStatus; selectedVehicleId?: string | null }) {
  const runtime = useDriverRuntime();
  const state = useDriverSession();
  const driverId = state.session?.driver.driverId;
  const [requested, setRequested] = useState(false);
  const allowed = !!state.session && desiredStatus === 'ONLINE' && !!selectedVehicleId;
  const token = useCallback(async (signal: AbortSignal) => {
    // Reuse SessionManager's existing serialized refresh through a protected Driver request.
    await runtime.driver.profile(signal);
    const session = runtime.session.getSnapshot().session;
    if (!session || session.driver.driverId !== driverId) throw new Error('UNAUTHENTICATED');
    return session.accessToken;
  }, [runtime, driverId]);
  const gps = useDriverGps(requested && allowed, token);
  return <Card>
    <Notice>Gửi vị trí khoảng 10 giây/lần khi màn hình tài xế đang mở.</Notice>
    <Action label={requested ? 'Tắt GPS' : 'Bật GPS'} disabled={!requested && !allowed} onPress={() => setRequested(value => !value)} />
    {!allowed && <Notice>Cần đăng nhập, chọn xe và bật nhận cuốc để gửi vị trí.</Notice>}
    <Notice>{gps.message}</Notice>
    {gps.lastAcceptedAt && <Notice>Cập nhật gần nhất: {gps.lastAcceptedAt}</Notice>}
  </Card>;
}
