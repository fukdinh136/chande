import { readFileSync } from 'node:fs';

export type ProcessKind = 'api' | 'worker' | 'migration';
export interface Config {
  production: boolean; port: number; workerPort: number; databaseUrl: string;
  poolSize: number; integrationMode: 'mock' | 'real'; vehicleTypes: string[];
  jwksUrl: string; issuer: string; audience: string; cursorKey: string; callbackToken: string;
  driverLookupToken?: string; driverJwksUrl?: string; driverIssuer?: string;
  routingUrl: string; pricingUrl: string; matchingUrl: string; gatewayUrl: string; notificationUrl: string;
  routingToken: string; pricingToken: string; matchingToken: string; gatewayToken: string; notificationToken: string;
  httpTimeout: number; pollInterval: number; batchSize: number; concurrency: number;
  leaseMs: number; retryBase: number; retryMax: number; heartbeatMaxAge: number; swagger: boolean;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env, kind: ProcessKind = 'api'): Config {
  const production = env.NODE_ENV === 'production';
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing configuration: ${name}`);
    return value;
  };
  const secret = (name: string, needed = true): string => {
    if (env[name] && env[`${name}_FILE`]) throw new Error(`Ambiguous secret: ${name}`);
    const value = env[`${name}_FILE`] ? readFileSync(env[`${name}_FILE`]!, 'utf8').trim() : env[name]?.trim();
    if (needed && !value) throw new Error(`Missing secret: ${name}`);
    return value ?? '';
  };
  const integer = (name: string, fallback: number, max = 1000000): number => {
    const raw = env[name] ?? String(fallback);
    if (!/^\d+$/.test(raw)) throw new Error(`Invalid integer: ${name}`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`Invalid range: ${name}`);
    return value;
  };
  const url = (name: string, needed: boolean): string => {
    if (!needed && !env[name]) return '';
    const value = required(name); const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error(`Invalid URL: ${name}`);
    return value.replace(/\/$/, '');
  };
  const mode = env.INTEGRATION_MODE ?? 'real';
  if (!['mock', 'real'].includes(mode) || (production && mode === 'mock')) throw new Error('Invalid integration mode');
  const api = kind === 'api'; const worker = kind === 'worker';
  const databaseUrl = secret('DATABASE_URL'); const database = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('PostgreSQL URL required');
  const vehicleTypes = api ? required('SUPPORTED_VEHICLE_TYPES').split(',').map(v => v.trim()) : [];
  if (vehicleTypes.some(v => !/^[A-Za-z0-9_-]{1,32}$/.test(v))) throw new Error('Invalid vehicle types');
  const jwksUrl = url('AUTH_JWKS_URL', api);
  if (production && api && !jwksUrl.startsWith('https://')) throw new Error('Production JWKS must use HTTPS');
  const leaseMs = integer('OUTBOX_LEASE_MS', 30000); const httpTimeout = integer('HTTP_TIMEOUT_MS', 5000);
  const retryBase = integer('OUTBOX_RETRY_BASE_MS', 1000); const retryMax = integer('OUTBOX_RETRY_MAX_MS', 300000);
  if (leaseMs <= httpTimeout || retryMax < retryBase) throw new Error('Invalid outbox timing');
  if (env.SWAGGER_ENABLED && !['true', 'false'].includes(env.SWAGGER_ENABLED)) throw new Error('Invalid Swagger flag');
  return {
    production, databaseUrl, integrationMode: mode as 'mock' | 'real', vehicleTypes,
    port: integer('PORT', 3001, 65535), workerPort: integer('WORKER_HEALTH_PORT', 3002, 65535), poolSize: integer('DB_POOL_SIZE', 10, 100),
    jwksUrl, issuer: api ? required('AUTH_JWT_ISSUER') : '', audience: api ? required('AUTH_JWT_AUDIENCE') : '',
    cursorKey: secret('CURSOR_SIGNING_KEY', api), callbackToken: secret('MATCHING_CALLBACK_TOKEN', api),
    driverLookupToken: secret('DRIVER_LOOKUP_TOKEN', false), driverJwksUrl: url('DRIVER_AUTH_JWKS_URL', false), driverIssuer: env.DRIVER_AUTH_JWT_ISSUER,
    routingUrl: url('ROUTING_BASE_URL', api), pricingUrl: url('PRICING_BASE_URL', api),
    matchingUrl: url('MATCHING_BASE_URL', worker), gatewayUrl: url('GATEWAY_EVENTS_BASE_URL', worker), notificationUrl: url('NOTIFICATION_BASE_URL', worker),
    routingToken: secret('ROUTING_TOKEN', api), pricingToken: secret('PRICING_TOKEN', api), matchingToken: secret('MATCHING_TOKEN', worker),
    gatewayToken: secret('GATEWAY_EVENTS_TOKEN', worker), notificationToken: secret('NOTIFICATION_TOKEN', worker),
    httpTimeout, leaseMs, retryBase, retryMax,
    pollInterval: integer('OUTBOX_POLL_INTERVAL_MS', 1000), batchSize: integer('OUTBOX_BATCH_SIZE', 20, 1000), concurrency: integer('OUTBOX_CONCURRENCY', 5, 100),
    heartbeatMaxAge: integer('WORKER_HEARTBEAT_MAX_AGE_MS', 30000), swagger: env.SWAGGER_ENABLED === 'true',
  };
}
