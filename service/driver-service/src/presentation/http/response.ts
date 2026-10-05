import { DriverRequest } from "./http.types";
export function envelope(req: DriverRequest, data: unknown) {
  return { data, meta: { requestId: req.requestId } };
}
