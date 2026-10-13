import { useMemo, useState, useSyncExternalStore } from 'react';
import { Pressable, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import type { Vehicle, VehicleInput } from '../contracts/models';
import { useDriverRuntime } from '../state/driver-provider';
import { useFocusedResource } from '../hooks/use-focused-resource';
import { useDriverResources } from '../state/session-resources';
import { useMutation } from '../hooks/use-mutation';
import { useFormDraft } from '../hooks/use-form-draft';
import { Action, Busy, Card, ErrorNotice, Field, Notice, Screen } from '../components/ui';
import { availabilityLabel, vehicleLabel, vehicleTypes } from '../presentation/format';
import { hasErrors, normalizeVehicle, serverFields, validateVehicle, vehicleInput, writeUncertain, type FieldErrors } from '../presentation/form';

const blank: VehicleInput = { vehicleType: '', licensePlate: '', brandModel: '', color: '' };
export function VehiclesScreen() {
  const runtime = useDriverRuntime(), driver = runtime.driver;
  const { intent: availability, active, store } = useDriverResources();
  const vehicles = useFocusedResource(store.vehicles);
  const creation = useSyncExternalStore(driver.subscribeVehicleCreation, driver.getVehicleCreation, driver.getVehicleCreation);
  const [editor, setEditor] = useState<string | 'new' | null>(creation ? 'new' : null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restoredInput, setRestoredInput] = useState<VehicleInput | undefined>(creation?.input);
  const [checkedCreation, setCheckedCreation] = useState<{ creation: typeof creation; checkedAt: number | null } | null>(null);
  const mutation = useMutation(runtime.session);
  const refresh = () => { vehicles.refresh(); availability.refresh(); active.refresh(); };
  const busy = mutation.busy || creation?.phase === 'sending';
  const editReason = !availability.data || availability.error ? 'Cần đọc được trạng thái nhận cuốc trước khi sửa hoặc chọn xe.'
    : availability.data.desiredStatus !== 'OFFLINE' ? 'Tắt nhận cuốc trước khi sửa hoặc chọn xe.'
    : availability.data.realtimeSync === 'PENDING' ? 'Chờ đồng bộ trạng thái nhận cuốc trước khi chọn xe.'
    : active.data ? 'Hoàn tất chuyến hiện tại trước khi sửa hoặc chọn xe.' : null;
  const freshCreationRead = creation?.phase === 'uncertain' && checkedCreation?.creation === creation && !!vehicles.checkedAt && vehicles.checkedAt !== checkedCreation.checkedAt && !vehicles.loading && !vehicles.error;
  const matching = creation && vehicles.data?.find(vehicle => vehicle.licensePlate.trim().toUpperCase() === creation.input.licensePlate);
  const matchingFields = matching && creation && Object.entries(creation.input).every(([key, item]) => matching[key as keyof Vehicle] === item);
  const readCreation = () => { setCheckedCreation({ creation, checkedAt: vehicles.checkedAt }); vehicles.refresh(); };
  const editedVehicle = editor && editor !== 'new' ? vehicles.data?.find(vehicle => vehicle.vehicleId === editor) ?? null : null;
  return <Screen title="Phương tiện" backToDriver>
    <Notice>{availabilityLabel(availability.data, availability.loading, availability.error)}</Notice>
    <Notice>Xe được kích hoạt có thể được chọn nhận cuốc. Bạn có thể có nhiều xe được kích hoạt; mỗi lần chỉ chọn một xe nhận cuốc.</Notice>
    {editReason && <Notice>{editReason}</Notice>}
    {(!runtime.trip.enabled || !!active.error) && <Notice>Ứng dụng chưa đọc được chuyến. Máy chủ Driver vẫn kiểm tra chuyến và reservation trước khi cho sửa hoặc chọn xe.</Notice>}
    <Action label="Cập nhật danh sách và trạng thái" variant="secondary" onPress={refresh} disabled={vehicles.loading || busy} />
    <Busy visible={vehicles.loading || availability.loading} /><ErrorNotice error={vehicles.error || availability.error || mutation.error} />
    {notice && <Notice tone="success">{notice}</Notice>}
    {mutation.notice && <Notice tone="success">{mutation.notice}</Notice>}
    {creation && <Card>
      <ThemedText type="smallBold">{creation.phase === 'sending' ? 'Đang đăng ký xe…' : 'Đăng ký xe chưa rõ kết quả'}</ThemedText>
      <Notice>Biển số: {creation.input.licensePlate}. {creation.phase === 'uncertain' ? 'Không tự gửi lại yêu cầu tạo xe. Nội dung được giữ trong phiên ứng dụng này để đối soát.' : 'Chờ phản hồi máy chủ trước khi đăng ký thêm xe.'}</Notice>
      {creation.phase === 'uncertain' && <>
        <ErrorNotice error={creation.error} />
        <Action label="Đọc danh sách để kiểm tra biển số" variant="secondary" onPress={readCreation} disabled={vehicles.loading || busy} />
        {freshCreationRead && (matching ? <>
          <Notice>{matchingFields ? 'Danh sách máy chủ có xe khớp biển số và thông tin đã gửi.' : 'Danh sách máy chủ có biển số này nhưng thông tin khác. Hãy xem xe đã đăng ký; chưa xác nhận yêu cầu cũ thành công.'}</Notice>
          <Action label="Xem xe đã có trên máy chủ" onPress={() => { driver.clearVehicleCreation(); setEditor(null); setNotice(`Đã đọc được xe ${matching.licensePlate} từ máy chủ.`); }} />
        </> : <>
          <Notice>Lần đọc này chưa có biển số đó; yêu cầu cũ vẫn có thể đã được xử lý. Chỉ tạo lại sau khi bạn đã kiểm tra, giữ nguyên biển số để ràng buộc duy nhất của máy chủ ngăn xe trùng.</Notice>
          <Action label="Tôi đã kiểm tra, cho phép sửa và gửi lại thủ công" variant="secondary" onPress={() => { setRestoredInput(creation.input); driver.clearVehicleCreation(); setCheckedCreation(null); setEditor('new'); }} />
        </>)}
        {editor !== 'new' && <Action label="Xem lại nội dung đăng ký" variant="secondary" onPress={() => setEditor('new')} />}
      </>}
    </Card>}
    {vehicles.data?.length === 0 && !vehicles.error && <Notice>Chưa đăng ký xe.</Notice>}
    {editor && (editor === 'new' || editedVehicle) && <VehicleForm key={editor} value={editedVehicle} initial={creation?.input ?? restoredInput}
      mutation={mutation} frozen={!!creation} canEdit={editor === 'new' || !editReason}
      checkedAt={vehicles.checkedAt} verified={!vehicles.loading && !vehicles.error}
      onSaved={saved => { setEditor(null); setNotice(`${editor === 'new' ? 'Đã đăng ký' : 'Đã lưu'} xe ${saved.licensePlate}.`); refresh(); }}
      onUncertain={refresh} onCancel={() => setEditor(null)} />}
    {vehicles.data?.map(vehicle => <Card key={vehicle.vehicleId}>
      <ThemedText type="smallBold">{vehicle.licensePlate} · {vehicle.brandModel}</ThemedText>
      <Notice>{vehicleLabel(vehicle.vehicleType)} · {vehicle.color}</Notice>
      <Notice>{vehicle.isActive ? 'Được kích hoạt' : 'Đã vô hiệu hóa'}</Notice>
      {availability.data?.selectedVehicleId === vehicle.vehicleId && <Notice>{availability.error || availability.data.realtimeSync === 'PENDING' ? 'Xe được chọn ở lần đọc gần nhất; đang chờ xác nhận đồng bộ.' : 'Xe đang được chọn nhận cuốc'}</Notice>}
      {!vehicle.isActive && <Notice>Kích hoạt xe trước khi chọn nhận cuốc.</Notice>}
      <Action label={availability.data?.selectedVehicleId === vehicle.vehicleId ? 'Đang chọn xe này' : `Chọn xe ${vehicle.licensePlate}`} variant="secondary"
        disabled={busy || !!editor || !!editReason || !vehicle.isActive || availability.data?.selectedVehicleId === vehicle.vehicleId}
        onPress={() => { void mutation.run(async isCurrent => { const value = await driver.selectVehicle(vehicle.vehicleId); if (isCurrent()) { availability.replace(value); refresh(); } }, `Đã lưu lựa chọn xe ${vehicle.licensePlate}; xem trạng thái đồng bộ bên trên.`); }} />
      <Action label="Chỉnh sửa xe" variant="secondary" disabled={busy || !!editor || !!editReason} onPress={() => { setNotice(null); setEditor(vehicle.vehicleId); }} />
      <Action label={vehicle.isActive ? 'Vô hiệu hóa xe' : 'Kích hoạt xe'} variant="secondary" disabled={busy || !!editor || !!editReason}
        onPress={() => { void mutation.run(async isCurrent => { await driver.updateVehicle(vehicle.vehicleId, { isActive: !vehicle.isActive }); if (isCurrent()) refresh(); }, `Đã ${vehicle.isActive ? 'vô hiệu hóa' : 'kích hoạt'} xe ${vehicle.licensePlate}.`); }} />
    </Card>)}
    {!editor && <Action label="Đăng ký phương tiện" disabled={busy || !!creation} onPress={() => { setNotice(null); setRestoredInput(undefined); mutation.clearError(); setEditor('new'); }} />}
  </Screen>;
}
function VehicleForm({ value, initial, mutation, frozen, canEdit, checkedAt, verified, onSaved, onCancel, onUncertain }: {
  value: Vehicle | null; initial?: VehicleInput; mutation: ReturnType<typeof useMutation>; frozen: boolean; canEdit: boolean;
  checkedAt: number | null; verified: boolean;
  onSaved: (value: Vehicle) => void; onCancel: () => void; onUncertain: () => void;
}) {
  const runtime = useDriverRuntime(), theme = useTheme();
  const [newInput] = useState(initial ?? blank);
  const source = useMemo(() => value ? vehicleInput(value) : newInput, [value, newInput]);
  const { fields, change, reset } = useFormDraft(source);
  const [errors, setErrors] = useState<FieldErrors<VehicleInput>>({});
  const [uncertainUpdate, setUncertainUpdate] = useState<{ input: VehicleInput; checkedAt: number | null } | null>(null);
  const fieldErrors = { ...errors, ...serverFields(mutation.error) };
  const checkedUpdate = !!uncertainUpdate && verified && !!checkedAt && checkedAt !== uncertainUpdate.checkedAt;
  const matchedUpdate = checkedUpdate && !!value && Object.entries(uncertainUpdate.input).every(([key, item]) => value[key as keyof Vehicle] === item);
  const editable = !mutation.busy && !frozen && canEdit && !uncertainUpdate;
  const input = (key: keyof VehicleInput, text: string) => { change(key, text); mutation.clearError(); setErrors(previous => ({ ...previous, [key]: undefined })); };
  const save = () => {
    const invalid = validateVehicle(fields); setErrors(invalid);
    if (hasErrors(invalid)) return;
    const body = normalizeVehicle(fields);
    void mutation.run(async isCurrent => {
      try {
        const saved = value ? await runtime.driver.updateVehicle(value.vehicleId, body) : await runtime.driver.createVehicle(body);
        if (isCurrent()) { reset(vehicleInput(saved)); onSaved(saved); }
      } catch (error) {
        if (isCurrent() && writeUncertain(error)) { if (value) setUncertainUpdate({ input: body, checkedAt }); onUncertain(); }
        throw error;
      }
    });
  };
  return <Card>
    <ThemedText type="smallBold" accessibilityRole="header">{value ? `Sửa xe ${value.licensePlate}` : 'Đăng ký phương tiện'}</ThemedText>
    <ThemedText type="small">Loại xe</ThemedText>
    <View accessibilityRole="radiogroup" style={{gap:8}}>{Object.entries(vehicleTypes).map(([code,label]) => <Pressable key={code} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{checked:fields.vehicleType===code,disabled:!editable}} disabled={!editable} onPress={() => input('vehicleType',code)}
      style={{minHeight:48,justifyContent:'center',padding:12,borderWidth:1,borderRadius:16,borderColor:theme.textSecondary,backgroundColor:fields.vehicleType===code?theme.backgroundSelected:theme.backgroundElement,opacity:editable?1:0.6}}><ThemedText type={fields.vehicleType===code?'smallBold':'small'}>{fields.vehicleType===code?'✓ ':''}{label}</ThemedText></Pressable>)}</View>
    <Field label="Mã loại xe" hint={`${vehicleLabel(fields.vehicleType)}. Mã khác chỉ dùng nếu máy chủ hỗ trợ.`} error={fieldErrors.vehicleType} value={fields.vehicleType} onChangeText={text => input('vehicleType', text)} editable={editable} autoCapitalize="characters" autoCorrect={false} />
    <Field label="Biển số" hint="1–15 ký tự" error={fieldErrors.licensePlate} value={fields.licensePlate} onChangeText={text => input('licensePlate', text)} editable={editable} autoCapitalize="characters" autoCorrect={false} />
    <Field label="Hãng / mẫu xe" hint="1–100 ký tự" error={fieldErrors.brandModel} value={fields.brandModel} onChangeText={text => input('brandModel', text)} editable={editable} />
    <Field label="Màu xe" hint="1–30 ký tự" error={fieldErrors.color} value={fields.color} onChangeText={text => input('color', text)} editable={editable} />
    {uncertainUpdate && <><Notice>{matchedUpdate ? 'Danh sách máy chủ đã phản ánh nội dung sửa xe.' : 'Chưa rõ yêu cầu sửa xe đã lưu. Đọc lại danh sách bằng nút phía trên rồi kiểm tra trước khi gửi tiếp.'}</Notice><Action label="Tôi đã xem lại thông tin xe, tiếp tục chỉnh sửa" variant="secondary" disabled={!canEdit || !checkedUpdate} onPress={() => setUncertainUpdate(null)} /></>}
    <Action label={mutation.busy ? 'Đang lưu phương tiện…' : 'Lưu phương tiện'} busy={mutation.busy} disabled={!editable || !!uncertainUpdate} onPress={save} />
    <Action label="Đóng biểu mẫu" variant="secondary" disabled={mutation.busy} onPress={onCancel} />
  </Card>;
}
