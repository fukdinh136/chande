import { useCallback, useState } from 'react';
import { ThemedText } from '@/components/themed-text';
import type { Vehicle, VehicleInput } from '../contracts/models';
import { useDriverRuntime } from '../state/driver-provider';
import { useFocusedResource } from '../hooks/use-focused-resource';
import { useMutation } from '../hooks/use-mutation';
import { ApiError } from '../http/errors';
import { Action, Busy, Card, ErrorNotice, Field, Notice, Screen } from '../components/ui';

const blank: VehicleInput = { vehicleType: 'CAR_4', licensePlate: '', brandModel: '', color: '' };
function validate(input: VehicleInput) {
  const value = { vehicleType: input.vehicleType.trim(), licensePlate: input.licensePlate.trim(), brandModel: input.brandModel.trim(), color: input.color.trim() };
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(value.vehicleType) || !value.licensePlate || value.licensePlate.length > 15 || !value.brandModel || value.brandModel.length > 100 || !value.color || value.color.length > 30) throw new ApiError('INVALID_REQUEST');
  return value;
}
export function VehiclesScreen() {
  const runtime = useDriverRuntime();
  const vehicles = useFocusedResource(useCallback((signal: AbortSignal) => runtime.driver.vehicles(signal), [runtime]));
  const availability = useFocusedResource(useCallback((signal: AbortSignal) => runtime.driver.availability(signal), [runtime]));
  const [editor, setEditor] = useState<Vehicle | 'new' | null>(null);
  const [uncertainCreation, setUncertainCreation] = useState(false);
  const mutation = useMutation();
  const refresh = () => { vehicles.refresh(); availability.refresh(); };
  return (
    <Screen title="Phương tiện" backToDriver>
      <Notice>Chọn hoặc sửa xe cần OFFLINE, không có chuyến và backend kết nối được Trip. Vô hiệu hóa xe đang chọn sẽ xóa lựa chọn; xe inactive không đủ điều kiện nhận cuốc.</Notice>
      <Action label="Tải lại danh sách và xe đang chọn" onPress={refresh} disabled={vehicles.loading || availability.loading || mutation.busy} />
      <Busy visible={vehicles.loading || availability.loading || mutation.busy} />
      <ErrorNotice error={vehicles.error || availability.error || mutation.error} />
      {availability.data?.realtimeSync === 'PENDING' && <Notice>Thông tin chọn xe chưa đồng bộ. Chưa thể xác nhận xe đang chọn.</Notice>}
      {vehicles.data?.length === 0 && <Notice>Chưa đăng ký xe.</Notice>}
      {uncertainCreation && <>
        <Notice>Yêu cầu tạo xe chưa rõ kết quả. Hãy tải danh sách, kiểm tra biển số rồi xác nhận trước khi tạo lại; API tạo xe chưa có idempotency.</Notice>
        <Action label="Tôi đã kiểm tra danh sách" onPress={() => setUncertainCreation(false)} disabled={vehicles.loading || !!vehicles.error} />
      </>}
      {vehicles.data?.map((value) => <Card key={value.vehicleId}>
        <ThemedText>{value.licensePlate} · {value.brandModel}</ThemedText>
        <Notice>{value.vehicleType} · {value.color} · {value.isActive ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}</Notice>
        {availability.data?.selectedVehicleId === value.vehicleId && <Notice>Xe đang chọn</Notice>}
        <Action label="Chọn xe" disabled={mutation.busy || !!editor || !value.isActive || availability.data?.desiredStatus !== 'OFFLINE'} onPress={() => { void mutation.run(async () => {
          availability.replace(await runtime.driver.selectVehicle(value.vehicleId)); refresh();
        }); }} />
        <Action label="Chỉnh sửa xe" disabled={mutation.busy || !!editor} onPress={() => setEditor(value)} />
        <Action label={value.isActive ? 'Vô hiệu hóa xe' : 'Kích hoạt lại xe'} disabled={mutation.busy || !!editor || availability.data?.desiredStatus !== 'OFFLINE'} onPress={() => { void mutation.run(async () => {
          await runtime.driver.updateVehicle(value.vehicleId, { isActive: !value.isActive }); refresh();
        }); }} />
      </Card>)}
      {!editor && <Action label="Đăng ký xe" disabled={mutation.busy || uncertainCreation} onPress={() => setEditor('new')} />}
      {editor && <VehicleForm key={editor === 'new' ? 'new' : editor.vehicleId} value={editor === 'new' ? null : editor}
        onSaved={() => { setEditor(null); refresh(); }} onCancel={() => setEditor(null)} onUncertain={() => { setUncertainCreation(true); setEditor(null); refresh(); }} />}
    </Screen>
  );
}
function VehicleForm({ value, onSaved, onCancel, onUncertain }: { value: Vehicle | null; onSaved: () => void; onCancel: () => void; onUncertain: () => void }) {
  const { driver } = useDriverRuntime();
  const [fields, setFields] = useState<VehicleInput>(value ?? blank);
  const mutation = useMutation();
  const change = (field: keyof VehicleInput, text: string) => setFields((previous) => ({ ...previous, [field]: text }));
  return <Card>
    <ThemedText>{value ? 'Sửa phương tiện' : 'Đăng ký phương tiện'}</ThemedText>
    <Field label="Loại xe (theo cấu hình backend, ví dụ BIKE)" value={fields.vehicleType} onChangeText={(text) => change('vehicleType', text)} editable={!mutation.busy} autoCapitalize="characters" />
    <Field label="Biển số (1–15 ký tự)" value={fields.licensePlate} onChangeText={(text) => change('licensePlate', text)} editable={!mutation.busy} autoCapitalize="characters" />
    <Field label="Hãng/model (1–100 ký tự)" value={fields.brandModel} onChangeText={(text) => change('brandModel', text)} editable={!mutation.busy} />
    <Field label="Màu (1–30 ký tự)" value={fields.color} onChangeText={(text) => change('color', text)} editable={!mutation.busy} />
    <Action label="Lưu phương tiện" disabled={mutation.busy} onPress={() => { void mutation.run(async () => {
      const body = validate(fields);
      try {
        if (value) await driver.updateVehicle(value.vehicleId, body); else await driver.createVehicle(body);
      } catch (error) {
        if (!value && error instanceof ApiError && (error.status === 0 || error.status >= 500)) onUncertain();
        throw error;
      }
      onSaved();
    }); }} />
    <Action label="Đóng biểu mẫu" disabled={mutation.busy} onPress={onCancel} />
    <Busy visible={mutation.busy} /><ErrorNotice error={mutation.error} />
  </Card>;
}
