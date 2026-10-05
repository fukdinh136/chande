import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Req,
  UseGuards,
  Inject,
  ParseUUIDPipe,
  Res,
} from "@nestjs/common";
import { Response } from "express";
import {
  DriverContext,
  CONTEXT,
} from "../../../bootstrap/modules/driver-context";
import { UserGuard } from "../guards/user.guard";
import { envelope } from "../response";
import { DriverRequest } from "../http.types";

import { VehicleDto, UpdateVehicleDto } from "../dto/vehicle.dto";

@Controller("drivers/me")
@UseGuards(UserGuard)
export class VehicleController {
  constructor(@Inject(CONTEXT) private readonly context: DriverContext) {}
  @Get("vehicles") async vehicles(@Req() req: DriverRequest) {
    return envelope(
      req,
      await this.context.vehicle.vehicles(req.principal.sub),
    );
  }
  @Get("vehicles/:id") async vehicle(
    @Req() req: DriverRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return envelope(
      req,
      await this.context.vehicle.vehicle(req.principal.sub, id),
    );
  }
  @Post("vehicles") async createVehicle(
    @Req() req: DriverRequest,
    @Body() dto: VehicleDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.context.vehicle.createVehicle(
      req.principal.sub,
      dto,
    );
    res.setHeader("Location", "/drivers/me/vehicles");
    return envelope(req, data);
  }
  @Patch("vehicles/:id") async updateVehicle(
    @Req() req: DriverRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return envelope(
      req,
      await this.context.vehicle.updateVehicle(
        req.principal.sub,
        id,
        dto,
        req.header("Authorization")!,
      ),
    );
  }
}
