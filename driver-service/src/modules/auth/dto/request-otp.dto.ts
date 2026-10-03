import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(15)
  @Matches(/^\+?[1-9]\d{8,14}$/, {
    message: 'phone must be a valid international phone number',
  })
  phone: string;
}