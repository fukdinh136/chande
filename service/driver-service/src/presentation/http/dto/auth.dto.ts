import {
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { Transform } from "class-transformer";
import { trim } from "./transform";
export class PhoneDto {
  @Transform(trim)
  @IsString()
  @Matches(/^\+?[1-9]\d{8,14}$/)
  phoneNumber!: string;
}
export class VerifyOtpDto extends PhoneDto {
  @IsUUID() challengeId!: string;
  @IsString() @Matches(/^\d{6}$/) otp!: string;
}
export class RefreshDto {
  @IsString() @MinLength(32) @MaxLength(256) refreshToken!: string;
}
