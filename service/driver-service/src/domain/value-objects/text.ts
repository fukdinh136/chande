import { DriverError } from "./error";
export function text(value: string, max: number): string {
  const result = value.trim();
  if (!result || result.length > max) throw new DriverError("INVALID_REQUEST");
  return result;
}
