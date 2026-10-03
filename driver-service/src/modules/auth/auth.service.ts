import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { DriverService } from '../driver/driver.service';
import { Driver } from '../driver/entities/driver.entity';

import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestOtpDto } from './dto/request-otp.dto';

import { OtpService } from './otp.service';
import { PasswordService } from './password.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly otpService: OtpService,
    private readonly driverService: DriverService,
    private readonly jwtService: JwtService,
    private readonly passwordService: PasswordService,
  ) {}

  // OTP chỉ phục vụ đăng ký tài khoản mới.
  async requestOtp(dto: RequestOtpDto) {
    const phone = dto.phone.trim();

    const existingDriver =
      await this.driverService.findByPhone(phone);

    if (existingDriver) {
      throw new ConflictException(
        'Phone number is already registered',
      );
    }

    const { code, expiresInSeconds } =
      this.otpService.generateOtp(phone);

    return {
      message: 'Registration OTP generated',
      phone,
      expiresInSeconds,

      // Chỉ dùng trong môi trường mock hiện tại.
      mockOtp: code,
    };
  }

  async register(dto: RegisterDto) {
    const existingDriver =
      await this.driverService.findByPhone(dto.phone);

    if (existingDriver) {
      throw new ConflictException(
        'Phone number is already registered',
      );
    }

    // Sai hoặc hết hạn OTP thì dừng, chưa tạo tài khoản.
    this.otpService.verifyOtp(
      dto.phone.trim(),
      dto.otp,
    );

    const passwordHash =
      await this.passwordService.hash(dto.password);

    const driver = await this.driverService.create(
      dto,
      passwordHash,
    );

    // Đăng ký thành công thì đăng nhập luôn.
    return this.createSession(driver);
  }

  async login(dto: LoginDto) {
    const driver =
      await this.driverService.findByPhoneWithPassword(
        dto.phone,
      );

    if (
      !driver?.passwordHash ||
      !(await this.passwordService.verify(
        dto.password,
        driver.passwordHash,
      ))
    ) {
      throw new UnauthorizedException(
        'Invalid phone number or password',
      );
    }

    // Không yêu cầu hoặc kiểm tra OTP ở đây.
    return this.createSession(driver);
  }

  private async createSession(driver: Driver) {
    const accessToken = await this.jwtService.signAsync({
      sub: driver.id,
      phone: driver.phone,
    });

    // Chỉ trả các trường công khai, không trả passwordHash.
    return {
      authenticated: true,
      requiresRegistration: false,
      accessToken,

      driver: {
        id: driver.id,
        phone: driver.phone,
        name: driver.name,
        status: driver.status,
      },
    };
  }
}