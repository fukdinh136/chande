import type {PlaceInput} from '../backend/clients';
import {BackendError} from '../backend/http';
import {newPasswordProblem} from './password-policy';

export type FormErrors = Record<string, string>;
export function validateProfile(name: string, avatar: string, previousAvatar: string | null) {
  const errors: FormErrors = {};
  if (!name.trim() || name.trim().length > 100) errors.fullName = 'Nhập họ tên từ 1–100 ký tự.';
  if (!avatar.trim() && previousAvatar) errors.avatarUrl = 'API chưa hỗ trợ xóa ảnh. Giữ URL hiện tại hoặc nhập URL mới.';
  else if (avatar.trim() && (avatar.trim().length > 500 || !/^https?:\/\/\S+$/.test(avatar.trim()))) errors.avatarUrl = 'Nhập URL http:// hoặc https://, tối đa 500 ký tự.';
  return errors;
}
export function validatePassword(oldPassword: string, newPassword: string, confirmation: string) {
  const errors: FormErrors = {};
  if (!oldPassword.trim() || oldPassword.length > 72) errors.oldPassword = 'Nhập mật khẩu hiện tại, tối đa 72 ký tự.';
  const problem = newPasswordProblem(newPassword);
  if (problem) errors.newPassword = problem;
  else if (newPassword === oldPassword) errors.newPassword = 'Mật khẩu mới phải khác mật khẩu hiện tại.';
  if (confirmation !== newPassword) errors.confirmation = 'Mật khẩu xác nhận chưa khớp.';
  return errors;
}
export interface PlaceDraft {label: string; addressText: string; lat: string; lng: string; makeDefault: boolean}
export function validatePlace(draft: PlaceDraft): {errors: FormErrors; input: PlaceInput} {
  const latitude = draft.lat.trim().replace(',', '.'), longitude = draft.lng.trim().replace(',', '.');
  const lat = Number(latitude), lng = Number(longitude), errors: FormErrors = {};
  if (draft.label.trim().length > 50) errors.label = 'Nhãn tối đa 50 ký tự.';
  if (!draft.addressText.trim() || draft.addressText.trim().length > 500) errors.addressText = 'Nhập địa chỉ từ 1–500 ký tự.';
  if (!latitude || !Number.isFinite(lat) || Math.abs(lat) > 90) errors.lat = 'Vĩ độ phải từ -90 đến 90.';
  if (!longitude || !Number.isFinite(lng) || Math.abs(lng) > 180) errors.lng = 'Kinh độ phải từ -180 đến 180.';
  return {errors, input: {label: draft.label.trim(), addressText: draft.addressText.trim(), lat, lng, makeDefault: draft.makeDefault}};
}
export function formFailure(error: unknown): FormErrors {
  const fields: FormErrors = {};
  if (error instanceof BackendError) {
    for (const key of ['fullName', 'avatarUrl', 'oldPassword', 'newPassword', 'label', 'addressText', 'lat', 'lng']) {
      if (error.fields && Object.hasOwn(error.fields, key)) fields[key] = 'Kiểm tra lại giá trị của trường này.';
    }
    if (error.code === 'WRONG_OLD_PASSWORD') fields.oldPassword = 'Mật khẩu hiện tại chưa đúng.';
    if (error.code === 'NEW_PASSWORD_SAME_AS_OLD') fields.newPassword = 'Mật khẩu mới phải khác mật khẩu hiện tại.';
  }
  return fields;
}
