import { IsISO8601, IsNumber, Matches, Max, Min } from 'class-validator';
import { LocationInput } from '../../../domain/location/driver-location';
// Socket payload keeps numeric JSON types; actor/type/status are not accepted fields.
export class LocationDto implements LocationInput {
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-85.05112878) @Max(85.05112878)
  latitude!: number;
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-180) @Max(180)
  longitude!: number;
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0)
  accuracy!: number;
  @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/)
  recordedAt!: string;
}
