import { Controller, Get, Inject, Res } from '@nestjs/common';
import { Response } from 'express';
import { LOCATION_STORE, LocationStore } from '../../../application/ports/location-store.port';
@Controller('health')
export class HealthController {
  constructor(@Inject(LOCATION_STORE) private readonly store: LocationStore) {}
  @Get('live') live() { return { status: 'ok' }; }
  @Get('ready') async ready(@Res() response: Response) {
    const ready = await this.store.ready();
    return response.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', redis: ready ? 'ready' : 'unavailable' });
  }
}
