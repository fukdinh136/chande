import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
export class BatchEligibilityDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsUUID(undefined, { each: true })
  driverIds!: string[];
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{1,20}$/)
  vehicleType?: string;
}
