import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { NearbyQuery, VEHICLE_TYPES, VehicleType } from '../../../domain/policies/nearby.policy';
// Query-string only. Arrays, whitespace, hex, empty strings and implicit booleans remain invalid.
const queryNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value) ? Number(value) : value;
export class NearbyDto implements NearbyQuery {
  @Transform(queryNumber) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-85.05112878) @Max(85.05112878)
  latitude!: number;
  @Transform(queryNumber) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-180) @Max(180)
  longitude!: number;
  @IsOptional() @Transform(queryNumber) @IsInt() @Min(1) @Max(2000)
  radiusMeters?: number;
  @IsOptional() @IsIn(VEHICLE_TYPES)
  vehicleType?: VehicleType;
}
