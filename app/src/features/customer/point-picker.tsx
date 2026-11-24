import {useState} from 'react';
import {View} from 'react-native';
import {ThemedText} from '@/components/themed-text';
import {Action, Busy, Field, Notice} from '../ui/components';
import {useBooking} from './booking-provider';
import {currentLocation} from './current-location';
import {SavedPlaces} from './saved-places';

export function PointPicker() {
  const {store, state, locked} = useBooking();
  const [saved, setSaved] = useState(false), [coordinates, setCoordinates] = useState(false);
  const [lat, setLat] = useState(''), [lng, setLng] = useState(''), [error, setError] = useState('');
  const candidate = state.candidate, title = state.selecting === 'pickup' ? 'điểm đón' : 'điểm đến';
  return <View style={{gap: 12}}>
    <ThemedText type="smallBold">Đang chọn {title}</ThemedText>
    <Notice>Chạm bản đồ, dùng vị trí hiện tại hoặc chọn địa chỉ yêu thích. Chỉ lưu điểm sau khi bạn xác nhận.</Notice>
    {candidate && <><ThemedText>{candidate.label}</ThemedText><Notice>Vị trí tạm chọn · chưa xác nhận</Notice></>}
    <Action label={state.gps.loading ? 'Đang lấy vị trí…' : 'Vị trí hiện tại'} variant="secondary" disabled={locked || state.gps.loading} onPress={() => {void store.requestLocation(currentLocation);}}/>
    <Busy visible={state.gps.loading}/>{state.gps.error && <Notice tone="error">{state.gps.error}</Notice>}
    <Action label={saved ? 'Đóng địa chỉ yêu thích' : 'Chọn từ địa chỉ yêu thích'} variant="secondary" disabled={locked} onPress={() => {setSaved(old => !old); store.cancelLocation(); store.setSheet('expanded');}}/>
    {saved && <SavedPlaces/>}
    <Action label={coordinates ? 'Ẩn tọa độ' : 'Xem / nhập tọa độ'} variant="secondary" onPress={() => {
      setCoordinates(old => !old); const point = candidate?.point ?? state.draft[state.selecting];
      setLat(point ? String(point.lat) : ''); setLng(point ? String(point.lng) : ''); setError(''); store.cancelLocation(); store.setSheet('expanded');
    }}/>
    {coordinates && <>
      {candidate && <Notice>Đang chọn: {candidate.point.lat.toFixed(6)}, {candidate.point.lng.toFixed(6)}</Notice>}
      <Field label="Vĩ độ" value={lat} onChangeText={value => {store.cancelLocation(); setLat(value);}} keyboardType="numbers-and-punctuation" autoCorrect={false} editable={!locked}/>
      <Field label="Kinh độ" value={lng} onChangeText={value => {store.cancelLocation(); setLng(value);}} keyboardType="numbers-and-punctuation" autoCorrect={false} editable={!locked}/>
      {error && <Notice tone="error">{error}</Notice>}
      <Action label="Đặt pin theo tọa độ" variant="secondary" disabled={locked} onPress={() => {
        const latitude = lat.trim().replace(',', '.'), longitude = lng.trim().replace(',', '.');
        if (!latitude || !longitude || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {setError('Nhập đầy đủ vĩ độ và kinh độ dạng số.'); return;}
        setError(''); store.proposePoint({lat: Number(latitude), lng: Number(longitude)});
      }}/>
    </>}
    <Action label={`Xác nhận ${title}`} disabled={locked || !candidate} onPress={store.confirmPoint}/>
    <Action label="Dừng chỉnh sửa vị trí" variant="secondary" disabled={locked} onPress={store.cancelEditing}/>
  </View>;
}
