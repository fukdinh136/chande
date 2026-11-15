import { Module } from '@nestjs/common';
import { Config, CONFIG, loadConfig } from '../config/configuration';
import { RedisConnection } from '../../infrastructure/redis/redis.connection';
import { RedisLocationRepository } from '../../infrastructure/redis/redis-location.repository';
import { JwksTokenVerifier } from '../../infrastructure/auth/jwks-token.verifier';
import { CleanupScheduler } from '../../infrastructure/scheduling/cleanup.scheduler';
import { LOCATION_STORE, LocationStore } from '../../application/ports/location-store.port';
import { TOKEN_VERIFIER } from '../../application/ports/token-verifier.port';
import { UpdateLocation } from '../../application/use-cases/update-location';
import { ListDriverLocations } from '../../application/use-cases/list-driver-locations';
import { DriverLocationsController } from '../../presentation/http/controllers/driver-locations.controller';
import { MATCHING_LOCATION_CREDENTIAL, MatchingServiceGuard } from '../../presentation/http/guards/matching-service.guard';
import { CleanupStale } from '../../application/use-cases/cleanup-stale';
import { LocationPolicy } from '../../domain/policies/location.policy';
import { LocationGateway } from '../../presentation/socket/location.gateway';
import { DriverSocketGuard } from '../../presentation/socket/guards/driver-socket.guard';
import { HealthController } from '../../presentation/http/controllers/health.controller';
import { OfferConsumer } from '../../infrastructure/offers/consumer';
import { GrpcClient, grpcAddress, internalTransport, loadService } from '../../infrastructure/grpc';
import { CircuitBreaker } from '../../infrastructure/circuit-breaker';
@Module({
  controllers: [DriverLocationsController, HealthController],
  providers: [
    // INTERNAL_TRANSPORT=grpc reads offers from Matching over gRPC instead of HTTP.
    { provide: OfferConsumer, inject: [RedisConnection, CONFIG], useFactory: (r: RedisConnection, c: Config) => new OfferConsumer(r.client, c, undefined, internalTransport() === 'grpc' && c.matchingUrl ? new GrpcClient(loadService('matching.proto', 'chande.matching.v1.MatchingInternal'), grpcAddress('matching', c.matchingUrl), 3000, new CircuitBreaker('matching')) : undefined) },
    { provide: CONFIG, useFactory: () => loadConfig() },
    { provide: RedisConnection, inject: [CONFIG], useFactory: (c: Config) => new RedisConnection(c.redisUrl, c.redisTimeoutMs) },
    { provide: LOCATION_STORE, inject: [RedisConnection, CONFIG], useFactory: (r: RedisConnection, c: Config) => new RedisLocationRepository(r.client, c.freshnessMs, c.maxFutureMs, c.orderRetentionMs, c.minIntervalMs, c.cleanupBatch) },
    { provide: TOKEN_VERIFIER, inject: [CONFIG], useFactory: (c: Config) => new JwksTokenVerifier(c.jwksUrl, c.issuer, c.audience, c.jwksTimeoutMs) },
    { provide: LocationPolicy, inject: [CONFIG], useFactory: (c: Config) => new LocationPolicy(c.freshnessMs, c.maxFutureMs, c.maxAccuracyMeters) },
    { provide: UpdateLocation, inject: [LOCATION_STORE, LocationPolicy], useFactory: (s: LocationStore, p: LocationPolicy) => new UpdateLocation(s, p) },
    { provide: ListDriverLocations, inject: [LOCATION_STORE, LocationPolicy], useFactory: (s: LocationStore, p: LocationPolicy) => new ListDriverLocations(s, p) },
    { provide: CleanupStale, inject: [LOCATION_STORE], useFactory: (s: LocationStore) => new CleanupStale(s) },
    { provide: CleanupScheduler, inject: [CleanupStale, CONFIG], useFactory: (u: CleanupStale, c: Config) => new CleanupScheduler(u, c.cleanupIntervalMs) },
    { provide: MATCHING_LOCATION_CREDENTIAL, inject: [CONFIG], useFactory: (c: Config) => c.matchingLocationToken },
    DriverSocketGuard, MatchingServiceGuard, LocationGateway,
  ],
})
export class RealtimeModule {}
