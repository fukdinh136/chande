import {
  Controller,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';

import {
  CurrentUser,
  type AuthenticatedDriver,
} from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { DriverService } from './driver.service';

@Controller('drivers')
@UseGuards(JwtAuthGuard)
export class DriverController {
  constructor(
    private readonly driverService: DriverService,
  ) {}

  @Get('me')
  getProfile(
    @CurrentUser() user: AuthenticatedDriver,
  ) {
    return this.driverService.findById(user.id);
  }

  @Patch('me/toggle-status')
  toggleStatus(
    @CurrentUser() user: AuthenticatedDriver,
  ) {
    return this.driverService.toggleStatus(user.id);
  }
}