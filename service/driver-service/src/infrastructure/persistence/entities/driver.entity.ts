import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { Vehicle } from "./vehicle.entity";
@Entity("drivers")
export class Driver {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({
    name: "phone_number",
    type: "varchar",
    length: 15,
    unique: true,
  })
  phone: string;

  @Column({
    name: "password_hash",
    type: "varchar",
    length: 255,
    select: false,
  })
  passwordHash: string;

  @Column({
    name: "full_name",
    type: "varchar",
    length: 100,
  })
  name: string;

  @Column({
    name: "avatar_url",
    type: "text",
    nullable: true,
  })
  avatarUrl: string | null;

  @Column({
    name: "license_number",
    type: "varchar",
    length: 20,
    unique: true,
  })
  licenseNumber: string;

  // Tên thuộc tính trong code khác tên cột trong database.
  @Column({
    name: "status",
    type: "varchar",
    length: 20,
  })
  desiredStatus: string;

  @OneToMany(() => Vehicle, (vehicle) => vehicle.driver)
  vehicles: Vehicle[];

  @CreateDateColumn({
    name: "created_at",
    type: "timestamptz",
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: "updated_at",
    type: "timestamptz",
  })
  updatedAt: Date;
}
