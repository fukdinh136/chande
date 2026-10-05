import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AvailabilityService } from './availability.service';

@Module({
  imports: [ConfigModule],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}