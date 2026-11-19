import {useEffect, useState} from 'react';
import {router, useLocalSearchParams} from 'expo-router';
import {Switch, View} from 'react-native';
import {ThemedText} from '@/components/themed-text';
import {Screen, Action, Busy, Card, Field, Notice} from '../ui/components';
import {RideMap} from '../map/ride-map';
import {useCustomerData} from './data-provider';
import {useOwnedForm} from './use-owned-form';
import {validatePlace, type PlaceDraft} from './account-form';

export function CustomerPlaceEditor({create = false}: {create?: boolean}) {
  const {id} = useLocalSearchParams<{id: string}>();
  return <PlaceEditor key={create ? 'new' : id} placeId={create ? undefined : id}/>;
}
function PlaceEditor({placeId}: {placeId?: string}) {
  const {data, places} = useCustomerData(), form = useOwnedForm();
  const [edited, setEdited] = useState<PlaceDraft | null>(null);
  const [dirty, setDirty] = useState(false), [leaving, setLeaving] = useState(false);
  useEffect(() => {if (placeId) void data.load();}, [data, placeId]);
  const source = places.items.find(item => item.id === placeId);
  const draft: PlaceDraft = edited ?? (source ? {label: source.label, addressText: source.addressText, lat: String(source.lat), lng: String(source.lng), makeDefault: source.isDefault} : {label: '', addressText: '', lat: '', lng: '', makeDefault: false});
  const initialized = !placeId || !!source || !!edited;
  const setDraft = (update: (old: PlaceDraft) => PlaceDraft) => setEdited(old => update(old ?? draft));
  const change = <K extends keyof PlaceDraft>(key: K, value: PlaceDraft[K]) => {setDraft(old => ({...old, [key]: value})); setDirty(true); form.setErrors({}); form.setMessage('');};
  const back = () => {if (router.canGoBack()) router.back(); else router.replace('/customer/account');};
  const busy = form.busy || places.busy;
  const point = validatePlace(draft);
  const mapPoint = !point.errors.lat && !point.errors.lng && Math.abs(point.input.lat) <= 85.05112878 ? {lat: point.input.lat, lng: point.input.lng} : undefined;
  const available = initialized;
  return <Screen title={placeId ? 'Sửa địa chỉ yêu thích' : 'Thêm địa chỉ yêu thích'}>
    <Action label="Quay lại tài khoản" variant="secondary" disabled={busy} onPress={() => {if (dirty) setLeaving(true); else back();}}/>
    {leaving && <Card><Notice>Bỏ nội dung địa chỉ chưa lưu?</Notice><Action label="Bỏ thay đổi và quay lại" variant="danger" onPress={back}/><Action label="Tiếp tục chỉnh sửa" variant="secondary" onPress={() => setLeaving(false)}/></Card>}
    <Busy visible={places.loading && !initialized}/>
    {placeId && places.error && <><Notice tone="error">{places.error}</Notice><Action label="Thử tải lại địa chỉ" disabled={busy || places.loading} onPress={() => {void data.load(true);}}/></>}
    {placeId && places.loaded && !places.error && !places.loading && !source && <Notice tone="error">Địa chỉ không còn tồn tại hoặc bạn không được xem. Nội dung chưa lưu vẫn được giữ nếu đã nhập.</Notice>}
    {available && <Card>
      <Notice>Chạm bản đồ hoặc nhập tọa độ. Vị trí mở bản đồ chưa phải địa chỉ đã chọn; không có tìm kiếm địa chỉ tự động.</Notice>
      <RideMap reportTileErrors height={260} candidate={mapPoint} candidateLabel="Địa chỉ đang chỉnh sửa" fitKey={placeId ?? 'new-place'} onSelect={busy ? undefined : point => {setDraft(old => ({...old, lat: String(point.lat), lng: String(point.lng)})); setDirty(true); form.setErrors({});}}/>
      <Field label="Nhãn địa chỉ (tùy chọn)" value={draft.label} onChangeText={value => change('label', value)} editable={!busy} error={form.errors.label} hint="Tối đa 50 ký tự, ví dụ Nhà hoặc Cơ quan."/>
      <Field label="Địa chỉ" value={draft.addressText} onChangeText={value => change('addressText', value)} editable={!busy} error={form.errors.addressText} multiline/>
      <Field label="Vĩ độ địa chỉ" value={draft.lat} onChangeText={value => change('lat', value)} editable={!busy} error={form.errors.lat} keyboardType="numbers-and-punctuation"/>
      <Field label="Kinh độ địa chỉ" value={draft.lng} onChangeText={value => change('lng', value)} editable={!busy} error={form.errors.lng} keyboardType="numbers-and-punctuation"/>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}><ThemedText style={{flex: 1}}>Đặt làm mặc định</ThemedText><Switch style={{minWidth: 48, minHeight: 48}} accessibilityLabel="Đặt làm mặc định" value={draft.makeDefault} disabled={busy || !!source?.isDefault} onValueChange={value => change('makeDefault', value)}/></View>
      <Notice>{source?.isDefault ? 'API giữ địa chỉ này là mặc định. Bạn có thể chọn địa chỉ khác làm mặc định trong danh sách.' : 'Địa chỉ đầu tiên luôn là mặc định theo máy chủ.'}</Notice>
      {!!form.message && <Notice tone={form.failed ? 'error' : 'success'}>{form.message}</Notice>}
      <Action label={placeId ? 'Lưu địa chỉ đã sửa' : 'Lưu địa chỉ mới'} busy={busy} onPress={() => {
        const result = validatePlace(draft); form.setErrors(result.errors);
        if (Object.keys(result.errors).length) return;
        void form.run(() => data.save(result.input, placeId), () => {setDirty(false); form.setMessage('Đã lưu địa chỉ.'); back();});
      }}/>
    </Card>}
  </Screen>;
}
