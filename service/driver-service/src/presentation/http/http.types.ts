import { Request } from "express";
import { Principal } from "../../domain/value-objects/identity";
export type DriverRequest = Request & {
  principal: Principal;
  requestId: string;
};
