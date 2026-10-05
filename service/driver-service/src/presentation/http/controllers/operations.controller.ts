import { Controller, Get, Inject, Res } from "@nestjs/common";
import { Response } from "express";
import {
  DriverContext,
  CONTEXT,
} from "../../../bootstrap/modules/driver-context";
@Controller()
export class OperationsController {
  constructor(@Inject(CONTEXT) private readonly context: DriverContext) {}
  @Get(".well-known/jwks.json") jwks() {
    return this.context.tokens.jwks;
  }
  @Get("health/live") live() {
    return { status: "ok" };
  }
  @Get("health/ready") async ready(@Res() res: Response) {
    const ready = await this.context.store.ready();
    res
      .status(ready ? 200 : 503)
      .json({ status: ready ? "ready" : "not_ready" });
  }
}
