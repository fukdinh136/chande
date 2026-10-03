import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { DriverStatus } from '../../../common/enums/driver-status.enum';
import { Vehicle } from '../../vehicle/entities/vehicle.entity';

@Entity('drivers')
export class Driver {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_driver_phone', { unique: true })
  @Column({
    name: 'phone_number',
    length: 15,
  })
  phone: string;

  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
    select: false,
  })
  passwordHash: string | null;

  @Column({
    name: 'full_name',
    length: 100,
  })
  name: string;

  @Column({
    name: 'avatar_url',
    type: 'text',
    nullable: true,
  })
  avatarUrl: string | null;

  @Index('IDX_driver_license_number', { unique: true })
  @Column({
    name: 'license_number',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  licenseNumber: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: DriverStatus.OFFLINE,
  })
  status: DriverStatus;

  @OneToMany(() => Vehicle, (vehicle) => vehicle.driver)
  vehicles: Vehicle[];

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
  })
  updatedAt: Date;
}