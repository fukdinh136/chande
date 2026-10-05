import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Driver } from "./driver.entity";
@Entity("vehicles")
export class Vehicle {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({
    name: "driver_id",
    type: "uuid",
  })
  driverId: string;

  @ManyToOne(() => Driver, (driver) => driver.vehicles, {
    nullable: false,
    onDelete: "NO ACTION",
  })
  @JoinColumn({ name: "driver_id" })
  driver: Driver;

  @Column({
    name: "vehicle_type",
    type: "varchar",
    length: 20,
  })
  vehicleType: string;

  @Column({
    name: "license_plate",
    type: "varchar",
    length: 15,
    unique: true,
  })
  vehiclePlate: string;

  @Column({
    name: "brand_model",
    type: "varchar",
    length: 100,
  })
  brandModel: string;

  @Column({
    type: "varchar",
    length: 30,
  })
  color: string;

  @Column({
    name: "is_active",
    type: "boolean",
    default: false,
  })
  isActive: boolean;

  @CreateDateColumn({
    name: "created_at",
    type: "timestamptz",
  })
  createdAt: Date;
}
