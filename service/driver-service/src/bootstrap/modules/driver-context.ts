import { ProfileUseCases } from "../../application/use-cases/profile/profile.use-cases";
import { VehicleUseCases } from "../../application/use-cases/vehicle/vehicle.use-cases";
import { AvailabilityUseCases } from "../../application/use-cases/availability/availability.use-cases";
import { EligibilityUseCase } from "../../application/use-cases/eligibility/eligibility.use-case";
import { BatchEligibilityUseCase } from "../../application/use-cases/eligibility/batch-eligibility.use-case";
import { EditPolicy } from "../../application/use-cases/vehicle/edit.policy";
import { DataSource } from "typeorm";
import Redis from "ioredis";
import { AuthUseCases } from "../../application/use-cases/auth/auth.use-cases";
import { PostgresStore } from "../../infrastructure/persistence/unit-of-work/postgres.store";
import { RsaTokens } from "../../infrastructure/auth/rsa-tokens";
import { runtime } from "../../infrastructure/auth/runtime";
import { MockOtp } from "../../infrastructure/otp/mock-otp";
import { HttpOtp } from "../../infrastructure/otp/http-otp";
import { RedisState } from "../../infrastructure/redis/redis-state";
import { HttpTripActive } from "../../infrastructure/clients/trip-active.client";
import { Config } from "../config/configuration";
export const CONTEXT = "DRIVER_CONTEXT";
export class DriverContext {
  readonly store: PostgresStore;
  readonly tokens: RsaTokens;
  readonly auth: AuthUseCases;
  readonly profile: ProfileUseCases;
  readonly vehicle: VehicleUseCases;
  readonly availability: AvailabilityUseCases;
  readonly eligibility: EligibilityUseCase;
  readonly batchEligibility: BatchEligibilityUseCase;
  private readonly redis: Redis;
  constructor(
    readonly config: Config,
    source: DataSource,
  ) {
    this.store = new PostgresStore(source, config.driverLockWait);
    this.redis = new Redis(config.redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: config.httpTimeout,
      connectTimeout: config.httpTimeout,
    });
    this.redis.on("error", () => {});
    const state = new RedisState(this.redis, config.vehicleTypes);
    this.tokens = new RsaTokens(
      config.issuer,
      config.audience,
      config.accessTtl,
      config.keyFile,
      config.keyId,
    );
    const otp =
      config.otpMode === "mock"
        ? new MockOtp(
            runtime,
            config.mockCode,
            config.otpTtl,
            config.otpCooldown,
            config.otpAttempts,
          )
        : new HttpOtp(config.otpUrl, config.otpToken, config.httpTimeout);
    this.auth = new AuthUseCases(
      this.store,
      otp,
      this.tokens,
      runtime,
      config.accessTtl,
      config.refreshTtl,
    );
    const policy = new EditPolicy(
      this.store,
      new HttpTripActive(config.tripUrl, config.httpTimeout),
    );
    this.profile = new ProfileUseCases(this.store, runtime, policy);
    this.vehicle = new VehicleUseCases(
      this.store,
      runtime,
      config.vehicleTypes,
      config.maxVehicles,
      policy,
      state,
    );
    this.availability = new AvailabilityUseCases(
      this.store,
      state,
      policy,
      runtime,
    );
    this.eligibility = new EligibilityUseCase(
      this.store,
      state,
      config.vehicleTypes,
    );
    this.batchEligibility = new BatchEligibilityUseCase(this.store, state, config.vehicleTypes);
  }
  async onModuleInit() {
    await this.store.assertSchema();
    try {
      await this.redis.connect();
    } catch {
      /* Redis-dependent endpoints return 503 */
    }
  }
  onModuleDestroy() {
    this.redis.disconnect();
  }
}
