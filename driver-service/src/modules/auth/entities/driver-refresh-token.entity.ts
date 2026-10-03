import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Driver } from '../../driver/entities/driver.entity';

@Entity('driver_refresh_tokens')
@Index('IDX_driver_refresh_token_driver', ['driverId'])
export class DriverRefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'driver_id',
    type: 'uuid',
  })
  driverId: string;

  @ManyToOne(() => Driver, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'driver_id' })
  driver: Driver;

  @Index('IDX_driver_refresh_token_hash', { unique: true })
  @Column({
    name: 'token_hash',
    length: 64,
    select: false,
  })
  tokenHash: string;

  @Column({
    name: 'expires_at',
    type: 'timestamptz',
  })
  expiresAt: Date;

  @Column({
    name: 'revoked_at',
    type: 'timestamptz',
    nullable: true,
  })
  revokedAt: Date | null;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  createdAt: Date;
}