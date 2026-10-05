import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { DriverRequest } from "../http.types";
export function clientAddress(
  req: DriverRequest,
  credential: string | undefined,
): string {
  const supplied = Buffer.from(req.header("X-Driver-Proxy-Token") ?? ""),
    expected = Buffer.from(credential ?? "");
  const address = req.header("X-Driver-Client-IP");
  if (
    expected.length &&
    supplied.length === expected.length &&
    timingSafeEqual(expected, supplied) &&
    address &&
    isIP(address)
  )
    return address;
  return req.ip ?? "unknown";
}
