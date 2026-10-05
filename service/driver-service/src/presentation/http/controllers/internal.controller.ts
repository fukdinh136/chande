import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
  Inject,
  ParseUUIDPipe,
} from "@nestjs/common";
import {
  DriverContext,
  CONTEXT,
} from "../../../bootstrap/modules/driver-context";
import { ServiceGuard } from "../guards/service.guard";
import { envelope } from "../response";
import { DriverRequest } from "../http.types";
import { EligibilityQuery } from "../dto/eligibility.dto";
@Controller("internal/drivers")
@UseGuards(ServiceGuard)
export class InternalController {
  constructor(@Inject(CONTEXT) private readonly context: DriverContext) {}
  @Get(":id/eligibility") async eligibility(
    @Req() req: DriverRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query() dto: EligibilityQuery,
  ) {
    return envelope(
      req,
      await this.context.eligibility.eligibility(id, dto.vehicleType),
    );
  }
}
