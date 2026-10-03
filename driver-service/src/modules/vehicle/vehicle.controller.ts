import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  CurrentUser,
  type AuthenticatedDriver,
} from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehicleService } from './vehicle.service';

@Controller('vehicles')
@UseGuards(JwtAuthGuard)
export class VehicleController {
  constructor(
    private readonly vehicleService: VehicleService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedDriver,
    @Body() dto: CreateVehicleDto,
  ) {
    return this.vehicleService.create(user.id, dto);
  }

  @Get()
  async getMyVehicles(
    @CurrentUser() user: AuthenticatedDriver,
  ) {
    return this.vehicleService.findMyVehicles(user.id);
  }

  @Get(':id')
  async getVehicle(
    @CurrentUser() user: AuthenticatedDriver,
    @Param('id', new ParseUUIDPipe()) vehicleId: string,
  ) {
    return this.vehicleService.findOneForDriver(
      user.id,
      vehicleId,
    );
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedDriver,
    @Param('id', new ParseUUIDPipe()) vehicleId: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.vehicleService.update(
      user.id,
      vehicleId,
      dto,
    );
  }
}