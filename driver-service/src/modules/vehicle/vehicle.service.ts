import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { DriverStatus } from '../../common/enums/driver-status.enum';
import { Driver } from '../driver/entities/driver.entity';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { Vehicle } from './entities/vehicle.entity';

@Injectable()
export class VehicleService {
  constructor(
    @InjectRepository(Vehicle)
    private readonly vehicles: Repository<Vehicle>,
  ) {}

  private async lockDriver(
    manager: EntityManager,
    driverId: string,
  ): Promise<Driver> {
    const driver = await manager.findOne(Driver, {
      where: { id: driverId },
      lock: {
        mode: 'pessimistic_write',
      },
    });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    return driver;
  }

  private resolveBrandModel(
    dto: UpdateVehicleDto,
  ): string | undefined {
    if (
      dto.brandModel !== undefined &&
      (dto.brand !== undefined || dto.model !== undefined)
    ) {
      throw new BadRequestException(
        'Send brandModel OR brand/model, not both',
      );
    }

    const value =
      dto.brandModel ??
      (dto.brand !== undefined || dto.model !== undefined
        ? [dto.brand, dto.model].filter(Boolean).join(' ')
        : undefined);

    if (value !== undefined && value.trim().length > 100) {
      throw new BadRequestException(
        'Combined brand/model must not exceed 100 characters',
      );
    }

    return value?.trim();
  }

  async create(
    driverId: string,
    dto: CreateVehicleDto,
  ): Promise<Vehicle> {
    return this.vehicles.manager.transaction(async (manager) => {
      const driver = await this.lockDriver(manager, driverId);
      const vehiclePlate = dto.vehiclePlate.trim().toUpperCase();

      const plateExists = await manager.exists(Vehicle, {
        where: { vehiclePlate },
      });

      if (plateExists) {
        throw new ConflictException(
          'A vehicle with this plate already exists',
        );
      }

      const hasActiveVehicle = await manager.exists(Vehicle, {
        where: {
          driverId,
          isActive: true,
        },
      });

      const isActive = dto.isActive ?? !hasActiveVehicle;

      if (isActive && driver.status !== DriverStatus.OFFLINE) {
        throw new BadRequestException(
          'Go offline before changing the active vehicle',
        );
      }

      if (isActive) {
        await manager.update(
          Vehicle,
          {
            driverId,
            isActive: true,
          },
          {
            isActive: false,
          },
        );
      }

      const vehicle = manager.create(Vehicle, {
        driverId,
        vehiclePlate,
        vehicleType: dto.vehicleType,
        brandModel: this.resolveBrandModel(dto),
        color: dto.color?.trim(),
        isActive,
      });

      return manager.save(Vehicle, vehicle);
    });
  }

  async findMyVehicles(driverId: string): Promise<Vehicle[]> {
    return this.vehicles.find({
      where: { driverId },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async findOneForDriver(
    driverId: string,
    vehicleId: string,
  ): Promise<Vehicle> {
    const vehicle = await this.vehicles.findOne({
      where: {
        id: vehicleId,
        driverId,
      },
    });

    if (!vehicle) {
      throw new NotFoundException(
        'Vehicle not found or does not belong to this driver',
      );
    }

    return vehicle;
  }

  async update(
    driverId: string,
    vehicleId: string,
    dto: UpdateVehicleDto,
  ): Promise<Vehicle> {
    return this.vehicles.manager.transaction(async (manager) => {
      const driver = await this.lockDriver(manager, driverId);

      const vehicle = await manager.findOne(Vehicle, {
        where: {
          id: vehicleId,
          driverId,
        },
      });

      if (!vehicle) {
        throw new NotFoundException(
          'Vehicle not found or does not belong to this driver',
        );
      }

      if (
        driver.status !== DriverStatus.OFFLINE &&
        (vehicle.isActive || dto.isActive === true)
      ) {
        throw new BadRequestException(
          'Go offline before changing the active vehicle',
        );
      }

      if (dto.vehiclePlate !== undefined) {
        vehicle.vehiclePlate = dto.vehiclePlate.trim().toUpperCase();
      }

      if (dto.vehicleType !== undefined) {
        vehicle.vehicleType = dto.vehicleType;
      }

      const brandModel = this.resolveBrandModel(dto);

      if (brandModel !== undefined) {
        vehicle.brandModel = brandModel;
      }

      if (dto.color !== undefined) {
        vehicle.color = dto.color.trim();
      }

      if (dto.isActive === true) {
        await manager.update(
          Vehicle,
          {
            driverId,
            isActive: true,
          },
          {
            isActive: false,
          },
        );
      }

      if (dto.isActive !== undefined) {
        vehicle.isActive = dto.isActive;
      }

      return manager.save(Vehicle, vehicle);
    });
  }
}