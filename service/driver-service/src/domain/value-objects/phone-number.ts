import { DriverError } from "./error";
export function phoneNumber(value: string): string {
  const phone = value.trim().replace(/^\+/, "");
  if (!/^[1-9]\d{8,14}$/.test(phone)) throw new DriverError("INVALID_REQUEST");
  return phone;
}
