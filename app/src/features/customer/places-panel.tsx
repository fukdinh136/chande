import {useEffect, useState} from 'react';
import {router} from 'expo-router';
import {ThemedText} from '@/components/themed-text';
import {Action, Busy, Card, Notice} from '../ui/components';
import {useCustomerData} from './data-provider';
import {placeLabel, type SavedPlace} from './places';
import {useOwnedForm} from './use-owned-form';

export function CustomerPlacesPanel({select}: {select: (place: SavedPlace, kind: 'pickup' | 'destination') => void}) {
  const {data, places} = useCustomerData(), form = useOwnedForm();
  const [deleting, setDeleting] = useState<SavedPlace | null>(null);
  useEffect(() => {void data.load();}, [data]);
  const busy = places.busy || form.busy;
  return <>
    <Notice>Tối đa 10 địa chỉ. Địa chỉ đầu tiên tự là mặc định. Sửa hoặc xóa địa chỉ không đổi điểm booking đã xác nhận.</Notice>
    <Action label="Thêm địa chỉ yêu thích" disabled={busy || places.items.length >= 10} onPress={() => router.push('/customer/places/new')}/>
    <Action label="Làm mới địa chỉ" variant="secondary" disabled={busy || places.loading} onPress={() => {void data.load(true);}}/>
    <Busy visible={places.loading}/>
    {!!places.error && <><Notice tone="error">{places.error} Danh sách gần nhất được giữ nếu đã tải.</Notice><Action label="Thử tải lại địa chỉ" variant="secondary" disabled={busy || places.loading} onPress={() => {void data.load(true);}}/></>}
    {places.loaded && !places.loading && !places.error && !places.items.length && <Notice>Bạn chưa có địa chỉ yêu thích.</Notice>}
    {places.items.map(place => <Card key={place.id}>
      <ThemedText type="smallBold">{placeLabel(place)}{place.isDefault ? ' · Mặc định' : ''}</ThemedText>
      <Notice>{place.addressText}</Notice><Notice>{place.lat}, {place.lng}</Notice>
      <Action label="Dùng làm điểm đón" variant="secondary" disabled={busy} onPress={() => select(place, 'pickup')}/>
      <Action label="Dùng làm điểm đến" variant="secondary" disabled={busy} onPress={() => select(place, 'destination')}/>
      <Action label="Sửa địa chỉ" variant="secondary" disabled={busy} onPress={() => router.push({pathname: '/customer/places/[id]', params: {id: place.id}})}/>
      <Action label="Đặt mặc định" variant="secondary" disabled={busy || place.isDefault} onPress={() => {void form.run(() => data.makeDefault(place.id), () => form.setMessage('Đã đặt địa chỉ mặc định.'));}}/>
      <Action label="Xóa địa chỉ" variant="danger" disabled={busy} onPress={() => {setDeleting(place); form.setMessage('');}}/>
    </Card>)}
    {deleting && <Card><Notice>Xóa địa chỉ “{placeLabel(deleting)}”? Điểm đã xác nhận trong booking vẫn được giữ.</Notice>
      <Action label="Xác nhận xóa địa chỉ" variant="danger" busy={busy} onPress={() => {void form.run(() => data.remove(deleting.id), () => {setDeleting(null); form.setMessage('Đã xóa địa chỉ.');});}}/>
      <Action label="Giữ địa chỉ" variant="secondary" disabled={busy} onPress={() => setDeleting(null)}/>
    </Card>}
    {!!form.message && <Notice tone={form.failed ? 'error' : 'success'}>{form.message}</Notice>}
  </>;
}
