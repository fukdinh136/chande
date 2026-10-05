import { readFileSync } from 'node:fs';
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const value = (name: string) => {
    if (env[name] && env[`${name}_FILE`]) throw new Error(`Ambiguous ${name}`);
    return (env[`${name}_FILE`] ? readFileSync(env[`${name}_FILE`]!, 'utf8') : env[name] ?? '').trim();
  };
  const required = (name: string) => { const result = value(name); if (!result) throw new Error(`${name} required`); return result; };
  const credential = (name: string) => { const result = required(name); if (result.length < 32 || result.startsWith('REPLACE_')) throw new Error(`${name} must be configured`); return result; };
  const integer = (name: string, fallback: number, max: number) => {
    const result = Number(value(name) || fallback);
    if (!Number.isInteger(result) || result < 1 || result > max) throw new Error(`Invalid ${name}`);
    return result;
  };
  const url = (name: string) => {
    const result = required(name).replace(/\/$/, ''), parsed = new URL(result);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error(`Invalid ${name}`);
    return result;
  };
  const redisUrl = required('REDIS_URL');
  if (!['redis:', 'rediss:'].includes(new URL(redisUrl).protocol)) throw new Error('Invalid REDIS_URL');
  const routingToken = credential('ROUTING_INBOUND_TOKEN'), driverToken = credential('DRIVER_ELIGIBILITY_TOKEN');
  if (routingToken === driverToken) throw new Error('Use separate service credentials');
  const freshnessMs = integer('LOCATION_FRESHNESS_MS', 30000, 30000);
  const orderRetentionMs = integer('LOCATION_ORDER_RETENTION_MS', 86400000, 604800000);
  if (orderRetentionMs <= freshnessMs) throw new Error('Order retention must exceed GPS freshness');
  return {
    port: integer('PORT', 3004, 65535), redisUrl,
    redisTimeoutMs: integer('REDIS_TIMEOUT_MS', 3000, 60000),
    jwksUrl: url('AUTH_JWKS_URL'), issuer: required('AUTH_JWT_ISSUER'), audience: value('AUTH_JWT_AUDIENCE') || 'realtime-service',
    jwksTimeoutMs: integer('AUTH_JWKS_TIMEOUT_MS', 3000, 10000),
    routingToken, driverToken, driverUrl: url('DRIVER_BASE_URL'), driverTimeoutMs: integer('DRIVER_TIMEOUT_MS', 3000, 10000),
    freshnessMs, maxFutureMs: integer('LOCATION_MAX_FUTURE_MS', 5000, 10000),
    maxAccuracyMeters: integer('LOCATION_MAX_ACCURACY_METERS', 100, 1000), orderRetentionMs,
    minIntervalMs: integer('LOCATION_MIN_UPDATE_INTERVAL_MS', 1000, 10000),
    cleanupIntervalMs: integer('CLEANUP_INTERVAL_MS', 10000, 60000), cleanupBatch: integer('CLEANUP_BATCH_SIZE', 500, 5000),
    maxCandidates: integer('NEARBY_MAX_CANDIDATES', 5000, 50000),
    origins: (value('SOCKET_CORS_ORIGINS') || 'http://localhost:8081,http://127.0.0.1:8081').split(',').map(origin => origin.trim()),
  };
}
export type Config = ReturnType<typeof loadConfig>;
export const CONFIG = Symbol('REALTIME_CONFIG');
