import {
  Body,
  Controller,
  Get,
  Put,
  Req,
  UseGuards,
  Inject,
} from "@nestjs/common";

import {
  DriverContext,
  CONTEXT,
} from "../../../bootstrap/modules/driver-context";
import { UserGuard } from "../guards/user.guard";
import { envelope } from "../response";
import { DriverRequest } from "../http.types";

import { SelectDto, AvailabilityDto } from "../dto/availability.dto";
@Controller("drivers/me")
@UseGuards(UserGuard)
export class AvailabilityController {
  constructor(@Inject(CONTEXT) private readonly context: DriverContext) {}
  @Put("selected-vehicle") async select(
    @Req() req: DriverRequest,
    @Body() dto: SelectDto,
  ) {
    return envelope(
      req,
      await this.context.availability.select(
        req.principal.sub,
        dto.vehicleId,
        req.header("Authorization")!,
      ),
    );
  }
  @Get("availability") async availability(@Req() req: DriverRequest) {
    return envelope(
      req,
      await this.context.availability.availability(req.principal.sub),
    );
  }
  @Put("availability") async setAvailability(
    @Req() req: DriverRequest,
    @Body() dto: AvailabilityDto,
  ) {
    return envelope(
      req,
      await this.context.availability.setAvailability(
        req.principal.sub,
        dto.desiredStatus,
      ),
    );
  }
}
