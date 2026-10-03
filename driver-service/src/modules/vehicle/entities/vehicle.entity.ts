import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { VehicleType } from '../../../common/enums/vehicle-type.enum';
import { Driver } from '../../driver/entities/driver.entity';

@Entity('vehicles')
@Index('IDX_vehicle_driver', ['driverId'])
@Index('IDX_vehicle_one_active', ['driverId'], {
  unique: true,
  where: '"is_active" = true',
})
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_vehicle_plate', { unique: true })
  @Column({
    name: 'license_plate',
    length: 15,
  })
  vehiclePlate: string;

  @Column({
    name: 'vehicle_type',
    type: 'varchar',
    length: 20,
  })
  vehicleType: VehicleType;

  @Column({
    name: 'brand_model',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  brandModel: string | null;

  @Column({
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  color: string | null;

  @Column({
    name: 'is_active',
    default: false,
  })
  isActive: boolean;

  @ManyToOne(() => Driver, (driver) => driver.vehicles, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'driver_id' })
  driver: Driver;

  @Column({
    name: 'driver_id',
    type: 'uuid',
  })
  driverId: string;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  createdAt: Date;
}