import { ApiError } from '../http/errors';
import type { DriverProfile, VehicleInput } from '../contracts/models';

export type ProfileInput = Pick<DriverProfile, 'fullName' | 'licenseNumber'> & { avatarUrl: string };
export type FieldErrors<T> = Partial<Record<keyof T, string>>;
export function profileInput(value: DriverProfile): ProfileInput {
  return { fullName: value.fullName, licenseNumber: value.licenseNumber, avatarUrl: value.avatarUrl ?? '' };
}
export function vehicleInput(value: VehicleInput): VehicleInput {
  return { vehicleType: value.vehicleType, licensePlate: value.licensePlate, brandModel: value.brandModel, color: value.color };
}
function lengthError(value: string, max: number) {
  return !value.trim() ? 'Vui lòng nhập thông tin này.' : value.trim().length > max ? `Nhập tối đa ${max} ký tự; nội dung hiện tại được giữ nguyên.` : undefined;
}
export function validateProfile(value: ProfileInput): FieldErrors<ProfileInput> {
  const errors: FieldErrors<ProfileInput> = { fullName: lengthError(value.fullName, 100), licenseNumber: lengthError(value.licenseNumber, 20) };
  const avatar = value.avatarUrl.trim();
  if (avatar) {
    try { const url = new URL(avatar); if (url.protocol !== 'https:' || !url.hostname || avatar.length > 2048) throw new Error(); }
    catch { errors.avatarUrl = 'Nhập URL HTTPS hợp lệ, tối đa 2048 ký tự, hoặc để trống để xóa ảnh.'; }
  }
  return errors;
}
export function validateVehicle(value: VehicleInput): FieldErrors<VehicleInput> {
  return {
    vehicleType: /^[A-Za-z0-9_-]{1,20}$/.test(value.vehicleType.trim()) ? undefined : 'Nhập mã loại xe hợp lệ (1–20 chữ, số, dấu _ hoặc -).',
    licensePlate: lengthError(value.licensePlate, 15), brandModel: lengthError(value.brandModel, 100), color: lengthError(value.color, 30),
  };
}
export function hasErrors<T>(errors: FieldErrors<T>) { return Object.values(errors).some(Boolean); }
export function serverFields(error: unknown) {
  if (!(error instanceof ApiError)) return {};
  if (error.code === 'LICENSE_NUMBER_CONFLICT') return { licenseNumber: 'Giấy phép này đã được đăng ký.' };
  if (error.code === 'LICENSE_PLATE_CONFLICT') return { licensePlate: 'Biển số này đã được đăng ký. Kiểm tra danh sách xe trước khi tạo lại.' };
  // Driver currently returns details: []; do not invent a field for INVALID_REQUEST.
  return {};
}
export { writeUncertain } from '../http/errors';
export function normalizeVehicle(value: VehicleInput): VehicleInput {
  return { vehicleType: value.vehicleType.trim(), licensePlate: value.licensePlate.trim().toUpperCase(), brandModel: value.brandModel.trim(), color: value.color.trim() };
}
