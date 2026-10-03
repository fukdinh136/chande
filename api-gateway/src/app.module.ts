import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { LocationGateway } from './gateway/location.gateway';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');

        if (!secret?.trim()) {
          throw new Error('JWT_SECRET must be configured');
        }

        return { secret };
      },
    }),

    RedisModule,
  ],
  providers: [LocationGateway],
})
export class AppModule {}