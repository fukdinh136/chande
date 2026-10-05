import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { FindNearby } from '../../../application/use-cases/find-nearby';
import { NearbyDto } from '../dto/nearby.dto';
import { RoutingServiceGuard } from '../guards/routing-service.guard';
import { envelope, RealtimeRequest } from '../response';
@Controller('internal/realtime')
@UseGuards(RoutingServiceGuard)
export class NearbyController {
  constructor(@Inject(FindNearby) private readonly find: FindNearby) {}
  @Get('nearby-drivers')
  async nearby(@Query() query: NearbyDto, @Req() request: RealtimeRequest) {
    return envelope(await this.find.execute(query), request.requestId);
  }
}
