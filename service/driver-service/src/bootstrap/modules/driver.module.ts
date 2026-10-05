import { ProfileController } from "../../presentation/http/controllers/profile.controller";
import { VehicleController } from "../../presentation/http/controllers/vehicle.controller";
import { AvailabilityController } from "../../presentation/http/controllers/availability.controller";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { loadConfig } from "../config/configuration";
import { DriverContext, CONTEXT } from "./driver-context";
import { Driver } from "../../infrastructure/persistence/entities/driver.entity";
import { Vehicle } from "../../infrastructure/persistence/entities/vehicle.entity";
import { DriverRefreshToken } from "../../infrastructure/persistence/entities/driver-refresh-token.entity";
import { AuthController } from "../../presentation/http/controllers/auth.controller";
import { InternalController } from "../../presentation/http/controllers/internal.controller";
import { OperationsController } from "../../presentation/http/controllers/operations.controller";
import { UserGuard } from "../../presentation/http/guards/user.guard";
import { ServiceGuard } from "../../presentation/http/guards/service.guard";
import { RealtimeServiceGuard } from "../../presentation/http/guards/realtime-service.guard";
import { RealtimeInternalController } from "../../presentation/http/controllers/realtime-internal.controller";
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        const config = loadConfig();
        return {
          type: "postgres",
          url: config.databaseUrl,
          connectTimeoutMS: config.databaseTimeout,
          extra: { query_timeout: config.databaseTimeout },
          entities: [Driver, Vehicle, DriverRefreshToken],
          installExtensions: false,
          synchronize: false,
          migrationsRun: false,
          logging: false,
          retryAttempts: 0,
        };
      },
    }),
  ],
  providers: [
    {
      provide: CONTEXT,
      inject: [DataSource],
      useFactory: (source: DataSource) =>
        new DriverContext(loadConfig(), source),
    },
    UserGuard,
    ServiceGuard,
    RealtimeServiceGuard,
  ],
  controllers: [
    AuthController,
    ProfileController,
    VehicleController,
    AvailabilityController,
    InternalController,
    RealtimeInternalController,
    OperationsController,
  ],
})
export class AppModule {}
