import { readFileSync } from 'node:fs';
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const value = (key: string, fallback = '') => {
    if (env[key] && env[key + '_FILE']) throw new Error('Ambiguous ' + key);
    return (env[key + '_FILE'] ? readFileSync(env[key + '_FILE']!, 'utf8') : env[key] ?? fallback).trim();
  };
  const required = (key: string) => { const v = value(key); if (!v) throw new Error(key + ' required'); return v; };
  const token = (key: string) => { const v = required(key); if (v.length < 32 || /^(REPLACE_|changeme)/i.test(v)) throw new Error('Configure ' + key); return v; };
  const url = (key: string, protocols: string[]) => { const v = required(key), u = new URL(v); if (!protocols.includes(u.protocol)) throw new Error('Invalid ' + key); return v.replace(/\/$/, ''); };
  const http = (key: string) => { const v = url(key, ['http:', 'https:']), u = new URL(v); if (u.username || u.password || u.search || u.hash) throw new Error('Invalid ' + key); return v; };
  const integer = (key: string, fallback: number, max: number) => { const v = Number(value(key, String(fallback))); if (!Number.isInteger(v) || v < 1 || v > max) throw new Error('Invalid ' + key); return v; };
  const tokens = { trip: token('MATCHING_TRIP_TOKEN'), driver: token('MATCHING_DRIVER_TOKEN'), realtime: token('MATCHING_REALTIME_TOKEN') };
  if (new Set(Object.values(tokens)).size !== 3) throw new Error('Separate inbound tokens required');
  return { port: integer('PORT', 3007, 65535), host: value('HOST', '127.0.0.1'), databaseUrl: url('DATABASE_URL', ['postgres:', 'postgresql:']), rabbitUrl: url('RABBITMQ_URL', ['amqp:', 'amqps:']), tokens,
    routingUrl: http('ROUTING_BASE_URL'), routingToken: token('ROUTING_MATCHING_TOKEN'), driverUrl: http('DRIVER_BASE_URL'), driverToken: token('DRIVER_MATCHING_TOKEN'), tripUrl: http('TRIP_BASE_URL'), tripToken: token('TRIP_MATCHING_TOKEN'),
    jwksUrl: http('AUTH_JWKS_URL'), issuer: required('AUTH_JWT_ISSUER'), audience: value('AUTH_JWT_AUDIENCE', 'matching-service'), httpTimeout: integer('HTTP_TIMEOUT_MS', 4500, 10000),
    workers: integer('WORKER_CONCURRENCY', 2, 16), pollMs: integer('SEARCH_POLL_MS', 5000, 60000), scanMs: integer('WORKER_SCAN_MS', 1000, 5000), leaseMs: 60000, swagger: value('SWAGGER_ENABLED', 'false') === 'true' };
}
export type Config = ReturnType<typeof loadConfig>;
