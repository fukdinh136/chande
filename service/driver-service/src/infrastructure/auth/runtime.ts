import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Runtime } from "../../application/ports/runtime.port";
export const runtime: Runtime = {
  now: () => new Date(),
  id: randomUUID,
  opaque: () => randomBytes(48).toString("base64url"),
  hash: (value) => createHash("sha256").update(value).digest("hex"),
};
