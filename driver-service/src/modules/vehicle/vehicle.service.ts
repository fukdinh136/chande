import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { AvailabilityService } from '../../availability/availability.service';
import { DriverAccountStatus } from '../../common/enums/driver-account-status.enum';
import { Driver } from '../driver/entities/driver.entity';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { Vehicle } from './entities/vehicle.entity';

@Injectable()
export class VehicleService {
  constructor(
    @InjectRepository(Vehicle)
    private readonly vehicles: Repository<Vehicle>,
    private readonly availability: AvailabilityService,
  ) {}

  private async lockDriver(
    manager: EntityManager,
    driverId: string,
  ): Promise<void> {
    const driver = await manager.findOne(Driver, {
      where: { id: driverId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    if (driver.accountStatus === DriverAccountStatus.BLOCKED) {
      throw new ForbiddenException('Driver account is blocked');
    }

    // PENDING vẫn được thêm xe để hoàn thiện hồ sơ.
  }

  async create(
    driverId: string,
    dto: CreateVehicleDto,
  ): Promise<Vehicle> {
    return this.vehicles.manager.transaction(async (manager) => {
      await this.lockDriver(manager, driverId);

      const vehiclePlate = dto.vehiclePlate.trim().toUpperCase();

      if (await manager.exists(Vehicle, { where: { vehiclePlate } })) {
        throw new ConflictException('Vehicle plate already exists');
      }

      const isActive = dto.isActive ?? false;

      if (
        isActive &&
        (await this.availability.get(driverId)) === 'ONLINE'
      ) {
        throw new BadRequestException(
          'Go offline before changing the active vehicle',
        );
      }

      if (isActive) {
        await manager.update(
          Vehicle,
          { driverId, isActive: true },
          { isActive: false },
        );
      }

      const vehicle = manager.create(Vehicle, {
        driverId,
        vehiclePlate,
        vehicleType: dto.vehicleType,
        brandModel: dto.brandModel.trim(),
        color: dto.color.trim(),
        isActive,
      });

      return manager.save(Vehicle, vehicle);
    });
  }

  async findMyVehicles(driverId: string): Promise<Vehicle[]> {
    return this.vehicles.find({
      where: { driverId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOneForDriver(
    driverId: string,
    vehicleId: string,
  ): Promise<Vehicle> {
    const vehicle = await this.vehicles.findOne({
      where: { id: vehicleId, driverId },
    });

    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    return vehicle;
  }

  async update(
    driverId: string,
    vehicleId: string,
    dto: UpdateVehicleDto,
  ): Promise<Vehicle> {
    return this.vehicles.manager.transaction(async (manager) => {
      await this.lockDriver(manager, driverId);

      const vehicle = await manager.findOne(Vehicle, {
        where: { id: vehicleId, driverId },
      });

      if (!vehicle) {
        throw new NotFoundException('Vehicle not found');
      }

      if (
        (vehicle.isActive || dto.isActive === true) &&
        (await this.availability.get(driverId)) === 'ONLINE'
      ) {
        throw new BadRequestException(
          'Go offline before editing or changing the active vehicle',
        );
      }

      if (dto.vehiclePlate !== undefined) {
        const vehiclePlate = dto.vehiclePlate.trim().toUpperCase();

        const duplicate = await manager.findOne(Vehicle, {
          where: { vehiclePlate },
        });

        if (duplicate && duplicate.id !== vehicle.id) {
          throw new ConflictException('Vehicle plate already exists');
        }

        vehicle.vehiclePlate = vehiclePlate;
      }

      if (dto.vehicleType !== undefined) {
        vehicle.vehicleType = dto.vehicleType;
      }

      if (dto.brandModel !== undefined) {
        vehicle.brandModel = dto.brandModel.trim();
      }

      if (dto.color !== undefined) {
        vehicle.color = dto.color.trim();
      }

      if (dto.isActive === true) {
        await manager.update(
          Vehicle,
          { driverId, isActive: true },
          { isActive: false },
        );
      }

      if (dto.isActive !== undefined) {
        vehicle.isActive = dto.isActive;
      }

      return manager.save(Vehicle, vehicle);
    });
  }
}