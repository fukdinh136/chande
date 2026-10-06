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
  const gps = useDriverGps(requested && allowed, token,runtime.config.gatewayBase);
  return <Card>
    <Notice>GPS foreground khoảng 10 giây/lần, duy trì khi mở lời mời hoặc chuyến.</Notice>
    <Action label={requested ? 'Tắt GPS' : 'Bật GPS'} disabled={!requested && !allowed} onPress={() => setRequested(value => !value)} />
    {!allowed && <Notice>Cần đăng nhập, chọn xe và bật nhận cuốc để gửi vị trí.</Notice>}
    <Notice>{gps.message}</Notice>
    {gps.lastAcceptedAt && <Notice>Cập nhật gần nhất: {gps.lastAcceptedAt}</Notice>}
  </Card>;
}
