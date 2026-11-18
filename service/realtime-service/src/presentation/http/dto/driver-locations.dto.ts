import { Transform } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { LocationQuery, MAX_LOCATIONS, MAX_OFFSET } from '../../../application/use-cases/list-driver-locations';
// Query-string only, same number rules as NearbyDto.
const queryNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value) ? Number(value) : value;
export class DriverLocationsDto implements LocationQuery {
  @Transform(queryNumber) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-85.05112878) @Max(85.05112878)
  latitude!: number;
  @Transform(queryNumber) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-180) @Max(180)
  longitude!: number;
  @IsOptional() @Transform(queryNumber) @IsInt() @Min(1) @Max(2000)
  radiusMeters?: number;
  @IsOptional() @Transform(queryNumber) @IsInt() @Min(1) @Max(MAX_LOCATIONS)
  limit?: number;
  @IsOptional() @Transform(queryNumber) @IsInt() @Min(0) @Max(MAX_OFFSET)
  offset?: number;
}
