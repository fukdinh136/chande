import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { CONTEXT, DriverContext } from '../../../bootstrap/modules/driver-context';
import { RealtimeServiceGuard } from '../guards/realtime-service.guard';
import { BatchEligibilityDto } from '../dto/batch-eligibility.dto';
import { DriverRequest } from '../http.types';
import { envelope } from '../response';
@Controller('internal/drivers')
@UseGuards(RealtimeServiceGuard)
export class RealtimeInternalController {
  constructor(@Inject(CONTEXT) private readonly context: DriverContext) {}
  @Post('eligibility/batch') @HttpCode(200) async eligibility(@Body() dto: BatchEligibilityDto, @Req() request: DriverRequest) {
    return envelope(request, await this.context.batchEligibility.execute(dto.driverIds, dto.vehicleType));
  }
}
