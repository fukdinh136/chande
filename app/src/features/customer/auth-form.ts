import {BackendError} from '../backend/http';
import {customerError} from './errors';
import {newPasswordProblem} from './password-policy';

export interface AuthValues {phoneNumber: string; password: string; fullName: string}
export type AuthErrors = Partial<Record<keyof AuthValues, string>>;
export function validateAuth(values: AuthValues, register: boolean): AuthErrors {
  const errors: AuthErrors = {};
  const phone = values.phoneNumber.trim().replace(/[\s.()-]/g, '').replace(/^0/, '+84').replace(/^84/, '+84');
  if (values.phoneNumber.trim().length > 20 || !/^\+84[35789]\d{8}$/.test(phone)) errors.phoneNumber = 'Nhập số di động Việt Nam, ví dụ 0912345678 hoặc +84912345678.';
  if (!values.password.trim()) errors.password = 'Nhập mật khẩu của bạn.';
  else if (values.password.length > 72) errors.password = 'Mật khẩu tối đa 72 ký tự.';
  else if (register) {const problem = newPasswordProblem(values.password); if (problem) errors.password = problem;}
  if (register && (!values.fullName.trim() || values.fullName.trim().length > 100)) errors.fullName = 'Nhập họ tên từ 1–100 ký tự.';
  return errors;
}
export function authFailure(error: unknown): {fields: AuthErrors; message: string} {
  const fields: AuthErrors = {};
  if (error instanceof BackendError) {
    // Do not render arbitrary server strings. Map known fields to local guidance.
    for (const key of ['phoneNumber', 'password', 'fullName'] as const) {
      if (error.fields && Object.hasOwn(error.fields, key)) fields[key] = key === 'phoneNumber' ? 'Kiểm tra số điện thoại Việt Nam đã nhập.' : key === 'password' ? 'Kiểm tra mật khẩu theo yêu cầu của biểu mẫu.' : 'Kiểm tra họ tên, tối đa 100 ký tự.';
    }
    if (error.code === 'INVALID_PHONE_NUMBER' || error.code === 'PHONE_ALREADY_EXISTS') fields.phoneNumber = customerError(error);
  }
  return {fields, message: customerError(error)};
}
