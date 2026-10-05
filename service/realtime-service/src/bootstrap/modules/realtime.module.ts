import { Module } from '@nestjs/common';
import { Config, CONFIG, loadConfig } from '../config/configuration';
import { RedisConnection } from '../../infrastructure/redis/redis.connection';
import { RedisLocationRepository } from '../../infrastructure/redis/redis-location.repository';
import { DriverEligibilityClient } from '../../infrastructure/clients/driver-eligibility.client';
import { JwksTokenVerifier } from '../../infrastructure/auth/jwks-token.verifier';
import { CleanupScheduler } from '../../infrastructure/scheduling/cleanup.scheduler';
import { LOCATION_STORE, LocationStore } from '../../application/ports/location-store.port';
import { ELIGIBILITY_PROVIDER, EligibilityProvider } from '../../application/ports/eligibility-provider.port';
import { TOKEN_VERIFIER } from '../../application/ports/token-verifier.port';
import { UpdateLocation } from '../../application/use-cases/update-location';
import { FindNearby } from '../../application/use-cases/find-nearby';
import { CleanupStale } from '../../application/use-cases/cleanup-stale';
import { LocationPolicy } from '../../domain/policies/location.policy';
import { NearbyPolicy } from '../../domain/policies/nearby.policy';
import { LocationGateway } from '../../presentation/socket/location.gateway';
import { DriverSocketGuard } from '../../presentation/socket/guards/driver-socket.guard';
import { NearbyController } from '../../presentation/http/controllers/nearby.controller';
import { HealthController } from '../../presentation/http/controllers/health.controller';
import { ROUTING_CREDENTIAL, RoutingServiceGuard } from '../../presentation/http/guards/routing-service.guard';
import { OfferConsumer } from '../../infrastructure/offers/consumer';
@Module({
  controllers: [NearbyController, HealthController],
  providers: [
    { provide: OfferConsumer, inject: [RedisConnection, CONFIG], useFactory: (r: RedisConnection, c: Config) => new OfferConsumer(r.client, c) },
    { provide: CONFIG, useFactory: () => loadConfig() },
    { provide: RedisConnection, inject: [CONFIG], useFactory: (c: Config) => new RedisConnection(c.redisUrl, c.redisTimeoutMs) },
    { provide: LOCATION_STORE, inject: [RedisConnection, CONFIG], useFactory: (r: RedisConnection, c: Config) => new RedisLocationRepository(r.client, c.freshnessMs, c.maxFutureMs, c.orderRetentionMs, c.minIntervalMs, c.cleanupBatch, c.maxCandidates) },
    { provide: ELIGIBILITY_PROVIDER, inject: [CONFIG], useFactory: (c: Config) => new DriverEligibilityClient(c.driverUrl, c.driverToken, c.driverTimeoutMs) },
    { provide: TOKEN_VERIFIER, inject: [CONFIG], useFactory: (c: Config) => new JwksTokenVerifier(c.jwksUrl, c.issuer, c.audience, c.jwksTimeoutMs) },
    { provide: LocationPolicy, inject: [CONFIG], useFactory: (c: Config) => new LocationPolicy(c.freshnessMs, c.maxFutureMs, c.maxAccuracyMeters) },
    { provide: UpdateLocation, inject: [LOCATION_STORE, LocationPolicy], useFactory: (s: LocationStore, p: LocationPolicy) => new UpdateLocation(s, p) },
    { provide: FindNearby, inject: [LOCATION_STORE, ELIGIBILITY_PROVIDER, LocationPolicy], useFactory: (s: LocationStore, e: EligibilityProvider, p: LocationPolicy) => new FindNearby(s, e, p, new NearbyPolicy()) },
    { provide: CleanupStale, inject: [LOCATION_STORE], useFactory: (s: LocationStore) => new CleanupStale(s) },
    { provide: CleanupScheduler, inject: [CleanupStale, CONFIG], useFactory: (u: CleanupStale, c: Config) => new CleanupScheduler(u, c.cleanupIntervalMs) },
    { provide: ROUTING_CREDENTIAL, inject: [CONFIG], useFactory: (c: Config) => c.routingToken },
    DriverSocketGuard, RoutingServiceGuard, LocationGateway,
  ],
})
export class RealtimeModule {}
