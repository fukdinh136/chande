import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AvailabilityService } from '../../availability/availability.service';
import { DriverAccountStatus } from '../../common/enums/driver-account-status.enum';
import { CreateDriverDto } from './dto/create-driver.dto';
import { Driver } from './entities/driver.entity';
import { Vehicle } from '../vehicle/entities/vehicle.entity';

@Injectable()
export class DriverService {
  constructor(
    @InjectRepository(Driver)
    private readonly driverRepository: Repository<Driver>,
    private readonly availability: AvailabilityService,
  ) {}

  async create(
    dto: CreateDriverDto,
    passwordHash: string,
  ): Promise<Driver> {
    const phone = this.normalizePhone(dto.phone);
    const licenseNumber = dto.licenseNumber.trim().toUpperCase();

    const existing = await this.driverRepository.findOne({
      where: [{ phone }, { licenseNumber }],
    });

    if (existing) {
      throw new ConflictException(
        'Phone number or license number is already registered',
      );
    }

    const driver = this.driverRepository.create({
      phone,
      passwordHash,
      name: dto.name.trim(),
      avatarUrl: dto.avatarUrl,
      licenseNumber,
      accountStatus: DriverAccountStatus.PENDING,
    });

    return this.driverRepository.save(driver);
  }

  async findById(id: string) {
    const driver = await this.driverRepository.findOne({
      where: { id },
      relations: { vehicles: true },
    });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    // Tài khoản chưa duyệt hoặc bị khóa không được duy trì Online.
    if (driver.accountStatus !== DriverAccountStatus.ACTIVE) {
      await this.availability.set(id, 'OFFLINE');
    }

    const status = await this.availability.get(id);

    // Chỉ trả các trường công khai, không trả passwordHash.
    return {
      id: driver.id,
      phone: driver.phone,
      name: driver.name,
      avatarUrl: driver.avatarUrl,
      licenseNumber: driver.licenseNumber,
      accountStatus: driver.accountStatus,
      status,
      vehicles: driver.vehicles,
      createdAt: driver.createdAt,
      updatedAt: driver.updatedAt,
    };
  }

  async findByPhone(phone: string): Promise<Driver | null> {
    return this.driverRepository.findOne({
      where: { phone: this.normalizePhone(phone) },
    });
  }

  async findByPhoneWithPassword(phone: string): Promise<Driver | null> {
    return this.driverRepository
      .createQueryBuilder('driver')
      .addSelect('driver.passwordHash')
      .where('driver.phone = :phone', {
        phone: this.normalizePhone(phone),
      })
      .getOne();
  }

  async toggleStatus(driverId: string) {
    // Cùng khóa hàng driver với VehicleService để tránh đổi xe
    // và bật Online đồng thời trong luồng của ứng dụng.
    await this.driverRepository.manager.transaction(async (manager) => {
      const driver = await manager.findOne(Driver, {
        where: { id: driverId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!driver) {
        throw new NotFoundException('Driver not found');
      }

      const current = await this.availability.get(driverId);

      // Luôn cho phép dừng làm việc.
      if (current === 'ONLINE') {
        await this.availability.set(driverId, 'OFFLINE');
        return;
      }

      if (driver.accountStatus !== DriverAccountStatus.ACTIVE) {
        throw new ForbiddenException(
          'Driver account must be ACTIVE before going online',
        );
      }

      const vehicle = await manager.findOne(Vehicle, {
        where: { driverId, isActive: true },
      });

      if (!vehicle) {
        throw new BadRequestException(
          'Select an active vehicle before going online',
        );
      }

      await this.availability.set(driverId, 'ONLINE');
    });

    return this.findById(driverId);
  }

  private normalizePhone(phone: string): string {
    return phone.trim().replace(/\s+/g, '');
  }
}