import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { LocationGateway } from './gateway/location.gateway';
import { RedisModule } from './redis/redis.module';
import { MockDispatchController } from './gateway/mock-dispatch.controller';
import { MockTripController } from './controllers/mock-trip.controller';

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
  controllers: [MockDispatchController, MockTripController],
})
export class AppModule {}