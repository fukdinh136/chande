import {
  IsString,
  Matches,
  MaxLength,
  MinLength,
  IsBoolean,
  ValidateIf,
} from "class-validator";
import { Transform } from "class-transformer";
import { trim } from "./transform";
export class VehicleDto {
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,20}$/)
  vehicleType!: string;
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(15)
  licensePlate!: string;
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  brandModel!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(30) color!: string;
}
export class UpdateVehicleDto {
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,20}$/)
  vehicleType?: string;
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(15)
  licensePlate?: string;
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  brandModel?: string;
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  color?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
