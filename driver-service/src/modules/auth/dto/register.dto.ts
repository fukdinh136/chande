import {
  IsByteLength,
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

import { CreateDriverDto } from '../../driver/dto/create-driver.dto';

export class RegisterDto extends CreateDriverDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, {
    message: 'otp must contain exactly 6 digits',
  })
  otp: string;

  @IsString()
  @MinLength(8, {
    message: 'password must contain at least 8 characters',
  })
  @IsByteLength(8, 72, {
    message: 'password must not exceed 72 bytes',
  })
  password: string;
}