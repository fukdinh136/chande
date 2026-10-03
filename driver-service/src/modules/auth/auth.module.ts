import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { SignOptions } from 'jsonwebtoken';

import { DriverModule } from '../driver/driver.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DriverRefreshToken } from './entities/driver-refresh-token.entity';
import { JwtStrategy } from './jwt.strategy';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    TypeOrmModule.forFeature([DriverRefreshToken]),

    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],

      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),

        signOptions: {
          expiresIn: configService.get<
            NonNullable<SignOptions['expiresIn']>
          >('jwt.expiresIn', '1d'),
        },
      }),
    }),

    DriverModule,
  ],

  controllers: [AuthController],

  providers: [
    AuthService,
    OtpService,
    JwtStrategy,
    PasswordService,
  ],

  exports: [AuthService],
})
export class AuthModule {}