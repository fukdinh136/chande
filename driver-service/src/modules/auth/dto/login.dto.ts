import {
  IsByteLength,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(15)
  @Matches(/^\+?[1-9]\d{8,14}$/, {
    message: 'phone must be a valid international phone number',
  })
  phone: string;

  @IsString()
  @MinLength(8)
  @IsByteLength(8, 72)
  password: string;
}