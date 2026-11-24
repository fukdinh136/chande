import {useState} from 'react';
import {router} from 'expo-router';
import type {Trip} from '../driver/contracts/models';
import {Action, Card, Notice} from '../ui/components';
import {useBooking} from './booking-provider';

export function RebookAction({trip}: {trip: Trip}) {
  const {store, state, command} = useBooking();
  const [revision, setRevision] = useState<number | null>(null), [message, setMessage] = useState('');
  const blocked = state.busy || command.busy || !!command.pending;
  const prepare = async (replace?: number) => {
    const result = await store.rebook(trip, replace);
    if (result.kind === 'ready') {setRevision(null); setMessage(''); router.navigate('/customer');}
    else if (result.kind === 'confirm') {setRevision(result.revision); setMessage('');}
    else {setRevision(null); setMessage(result.kind === 'invalid' ? 'Chuyến này chưa đủ điểm hoặc loại xe hợp lệ để đặt lại.' : 'Chưa thể đặt lại. Hãy kiểm tra chuyến hoặc thao tác đang chờ ở tab Đặt xe.');}
  };
  return <>
    <Action label="Đặt lại" variant="secondary" disabled={blocked} onPress={() => {void prepare();}}/>
    {revision !== null && <Card><Notice>Bạn đang có bản nháp đặt xe. Thay bằng hành trình này? Giá cũ sẽ được bỏ và bạn cần lấy báo giá mới.</Notice>
      <Action label="Thay bản nháp và chọn xe" disabled={blocked} onPress={() => {void prepare(revision);}}/>
      <Action label="Giữ bản nháp hiện tại" variant="secondary" disabled={blocked} onPress={() => setRevision(null)}/>
    </Card>}
    {!!message && <Notice tone="error">{message}</Notice>}
  </>;
}
