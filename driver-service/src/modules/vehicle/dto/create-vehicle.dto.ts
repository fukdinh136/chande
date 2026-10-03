import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { VehicleType } from '../../../common/enums/vehicle-type.enum';

export class CreateVehicleDto {
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim().toUpperCase()
      : value,
  )
  @IsString()
  @Length(5, 15)
  @Matches(/^[A-Z0-9 .-]+$/)
  vehiclePlate: string;

  @IsEnum(VehicleType)
  vehicleType: VehicleType;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  brandModel?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  brand?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  model?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(30)
  color?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}