import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DriverModule } from '../driver/driver.module';
import { VehicleController } from './vehicle.controller';
import { VehicleService } from './vehicle.service';
import { Vehicle } from './entities/vehicle.entity';
import { AvailabilityModule } from '../../availability/availability.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Vehicle]),
    DriverModule,
    AvailabilityModule,
  ],
  controllers: [VehicleController],
  providers: [VehicleService],
})
export class VehicleModule {}