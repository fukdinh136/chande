import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DriverStatus } from '../../common/enums/driver-status.enum';
import { Vehicle } from '../vehicle/entities/vehicle.entity';
import { CreateDriverDto } from './dto/create-driver.dto';
import { Driver } from './entities/driver.entity';

@Injectable()
export class DriverService {
  constructor(
    @InjectRepository(Driver)
    private readonly driverRepository: Repository<Driver>,
  ) {}

  async create(
    dto: CreateDriverDto,
    passwordHash: string,
  ): Promise<Driver> {
    const phone = this.normalizePhone(dto.phone);

    const existingDriver = await this.driverRepository.findOne({
      where: { phone },
    });

    if (existingDriver) {
      throw new ConflictException(
        'Phone number is already registered',
      );
    }

    const driver = this.driverRepository.create({
      phone,
      name: dto.name.trim(),
      passwordHash,
      avatarUrl: dto.avatarUrl,
      licenseNumber: dto.licenseNumber,
      status: DriverStatus.OFFLINE,
    });

    return this.driverRepository.save(driver);
  }

  async findById(id: string): Promise<Driver> {
    const driver = await this.driverRepository.findOne({
      where: { id },
      relations: {
        vehicles: true,
      },
    });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    return driver;
  }

  async findByPhone(phone: string): Promise<Driver | null> {
    return this.driverRepository.findOne({
      where: {
        phone: this.normalizePhone(phone),
      },
    });
  }

  async toggleStatus(driverId: string): Promise<Driver> {
    return this.driverRepository.manager.transaction(
      async (manager) => {
        const driver = await manager.findOne(Driver, {
          where: { id: driverId },
          lock: {
            mode: 'pessimistic_write',
          },
        });

        if (!driver) {
          throw new NotFoundException('Driver not found');
        }

        if (driver.status === DriverStatus.OFFLINE) {
          const activeVehicle = await manager.findOne(Vehicle, {
            where: {
              driverId,
              isActive: true,
            },
          });

          if (!activeVehicle) {
            throw new BadRequestException(
              'Select an active vehicle before going online',
            );
          }
        }

        driver.status =
          driver.status === DriverStatus.ONLINE
            ? DriverStatus.OFFLINE
            : DriverStatus.ONLINE;

        return manager.save(Driver, driver);
      },
    );
  }

  private normalizePhone(phone: string): string {
    return phone.trim().replace(/\s+/g, '');
  }

  async findByPhoneWithPassword(
    phone: string,
  ): Promise<Driver | null> {
    return this.driverRepository
      .createQueryBuilder('driver')
      .addSelect('driver.passwordHash')
      .where('driver.phone = :phone', {
        phone: this.normalizePhone(phone),
      })
      .getOne();
  }
}