import {
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  IsUrl,
} from "class-validator";
import { Transform } from "class-transformer";
import { trim } from "./transform";
export class ProfileDto {
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  fullName?: string;
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUrl({ protocols: ["https"], require_protocol: true })
  @MaxLength(2048)
  avatarUrl?: string | null;
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  licenseNumber?: string;
}
