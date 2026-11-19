import {useEffect} from 'react';
import {router} from 'expo-router';
import {Action, Busy, Notice} from '../ui/components';
import {useCustomerData} from './data-provider';
import {placeLabel} from './places';
import {useBooking} from './booking-provider';

export function SavedPlaces() {
  const {data, places: result} = useCustomerData(), {store, locked} = useBooking();
  useEffect(() => {void data.load();}, [data]);
  return <>
    <Busy visible={result.loading}/>
    {result.error && <><Notice tone="error">{result.error}</Notice><Action label="Thử tải lại địa chỉ" variant="secondary" disabled={result.loading || result.busy} onPress={() => {void data.load(true);}}/></>}
    {result.loaded && !result.loading && !result.error && !result.items.length && <Notice>Bạn chưa có địa chỉ yêu thích. Vẫn có thể chọn vị trí trên bản đồ.</Notice>}
    {result.items.map(place => <Action key={place.id} label={`${placeLabel(place)}${place.isDefault ? ' · Mặc định' : ''} · ${place.addressText}`} variant="secondary" disabled={locked || result.busy}
      onPress={() => store.proposePoint({lat: place.lat, lng: place.lng, address: place.addressText}, placeLabel(place))}/>)}
    <Action label="Quản lý địa chỉ yêu thích" variant="secondary" onPress={() => router.navigate('/customer/account')}/>
  </>;
}
