import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { ListDriverLocations } from '../../../application/use-cases/list-driver-locations';
import { DriverLocationsDto } from '../dto/driver-locations.dto';
import { MatchingServiceGuard } from '../guards/matching-service.guard';
import { envelope, RealtimeRequest } from '../response';
@Controller('internal/realtime')
@UseGuards(MatchingServiceGuard)
export class DriverLocationsController {
  constructor(@Inject(ListDriverLocations) private readonly list: ListDriverLocations) {}
  @Get('driver-locations')
  async locations(@Query() query: DriverLocationsDto, @Req() request: RealtimeRequest) {
    return envelope(await this.list.execute(query), request.requestId);
  }
}
