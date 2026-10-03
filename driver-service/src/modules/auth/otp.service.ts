import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface OtpRecord {
  code: string;
  expiresAt: number;
}

@Injectable()
export class OtpService {
  private readonly otpStore = new Map<string, OtpRecord>();

  constructor(private readonly configService: ConfigService) {}

  generateOtp(phone: string) {
    const code = this.configService.get<string>('otp.mockCode', '123456');

    const expiresInSeconds = this.configService.get<number>(
      'otp.expiresInSeconds',
      300,
    );

    const expiresAt = Date.now() + expiresInSeconds * 1000;

    this.otpStore.set(phone, {
      code,
      expiresAt,
    });

    return {
      expiresInSeconds,
      code,
    };
  }

  verifyOtp(phone: string, otp: string): boolean {
    const record = this.otpStore.get(phone);

    if (!record) {
      throw new UnauthorizedException('OTP was not requested');
    }

    if (Date.now() > record.expiresAt) {
      this.otpStore.delete(phone);

      throw new UnauthorizedException('OTP has expired');
    }

    if (record.code !== otp) {
      throw new UnauthorizedException('Invalid OTP');
    }

    this.otpStore.delete(phone);

    return true;
  }
}