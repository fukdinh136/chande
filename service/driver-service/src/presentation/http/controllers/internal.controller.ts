import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
  Inject,
  ParseUUIDPipe,
  Post,
  HttpCode,
  Body,
} from "@nestjs/common";
import {
  DriverContext,
  CONTEXT,
} from "../../../bootstrap/modules/driver-context";
import { ServiceGuard } from "../guards/service.guard";
import { envelope } from "../response";
import { DriverRequest } from "../http.types";
import { EligibilityQuery } from "../dto/eligibility.dto";
import { CandidatesDto } from "../dto/candidates.dto";
@Controller("internal/drivers")
@UseGuards(ServiceGuard)
export class InternalController {
  constructor(@Inject(CONTEXT) private readonly context: DriverContext) {}
  // Matching checks a whole candidate list in one call (ADR-0001).
  @Post("eligibility/candidates") @HttpCode(200) async candidates(
    @Req() req: DriverRequest,
    @Body() dto: CandidatesDto,
  ) {
    return envelope(
      req,
      await this.context.candidates.execute(dto.driverIds, dto.vehicleType),
    );
  }
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
