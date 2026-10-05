import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { z } from 'zod';

const profilesSchema = z.object({ schemaVersion: z.literal(1), vehicleTypes: z.record(z.string(), z.object({
  profile: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullable(), baseUrl: z.string().nullable(),
}).strict()) }).strict();
type Mode = 'mock' | 'real';
export interface Profile { profile: string; baseUrl: string }
export interface Config {
  production: boolean; host: string; port: number; swagger: boolean; logLevel: string;
  vehicleTypes: string[]; profiles: Record<string, Profile>; tokens: { trip: string; matching: string; gateway: string };
  map: { mode: Mode; auth: 'none' | 'header'; key: string; keyHeader: string; baseUrl: string };
  realtime: { mode: Mode; baseUrl: string; token: string; timeout: number; maxResponse: number; radius: 2000 };
  limits: { deadline: number; upstreamTimeout: number; attempts: number; retryBase: number; maxResponse: number;
    queueSize: number; admissionTimeout: number; queueWait: number; workers: number; rps: number; burst: number;
    rateWait: number; elementsPerMinute: number; matrixCandidates: number; matrixBatch: number; shutdownGrace: number };
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env, options: { root?: string; read?: (file: string) => string } = {}): Config {
  const root = options.root ?? process.cwd();
  const read = options.read ?? ((file: string) => readFileSync(file, 'utf8'));
  const invalid = (name: string): never => { throw new Error('Invalid configuration: ' + name); };
  const text = (name: string, fallback = '') => env[name]?.trim() ?? fallback;
  const checked = <T>(schema: z.ZodType<T>, value: unknown, name: string): T => {
    const result = schema.safeParse(value); return result.success ? result.data : invalid(name);
  };
  const integer = (name: string, fallback: number, max = 1000000): number => {
    const raw = text(name, String(fallback));
    if (!/^\d+$/.test(raw)) return invalid(name);
    return checked(z.number().int().min(1).max(max), Number(raw), name);
  };
  const boolean = (name: string, fallback: boolean): boolean => checked(z.enum(['true', 'false']), text(name, String(fallback)), name) === 'true';
  const secret = (name: string, needed: boolean): string => {
    const inline = text(name); const file = text(name + '_FILE');
    if (inline && file) return invalid(name);
    let value = inline;
    if (file) { try { value = read(resolve(root, file)).trim(); } catch { return invalid(name); } }
    if ((needed && !value) || (value && (/\r|\n/.test(value) || /^(your[_-]|changeme|replace[_-])/i.test(value)))) return invalid(name);
    return value;
  };
  const appEnv = checked(z.enum(['development', 'test', 'production']), text('APP_ENV', 'development'), 'APP_ENV');
  const production = appEnv === 'production' || env.NODE_ENV === 'production';
  const mode = (name: string): Mode => {
    const value = checked(z.enum(['mock', 'real']), text(name, 'mock'), name);
    if (production && value === 'mock') return invalid(name); return value;
  };
  const mapMode = mode('INTEGRATION_MODE'); const realtimeMode = mode('REALTIME_INTEGRATION_MODE');
  checked(z.literal('osrm'), text('EXTERNAL_MAP_PROVIDER', 'osrm'), 'EXTERNAL_MAP_PROVIDER');
  const auth = checked(z.enum(['none', 'header']), text('EXTERNAL_MAP_AUTH_MODE', 'none'), 'EXTERNAL_MAP_AUTH_MODE');
  const allowHttp = boolean('EXTERNAL_MAP_ALLOW_HTTP', false);
  const hosts = text('EXTERNAL_MAP_ALLOWED_HOSTS', '127.0.0.1,localhost,osrm').split(',').map(s => s.trim().toLowerCase());
  if (hosts.some(h => !/^[a-z0-9.-]+$/.test(h))) return invalid('EXTERNAL_MAP_ALLOWED_HOSTS');
  const mapUrl = (value: string, name: string): string => {
    if (!value) return '';
    let url: URL; try { url = new URL(value); } catch { return invalid(name); }
    if (!hosts.includes(url.hostname.toLowerCase()) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return invalid(name);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowHttp && auth === 'none')) return invalid(name);
    return url.origin;
  };
  const baseUrl = mapUrl(text('EXTERNAL_MAP_BASE_URL'), 'EXTERNAL_MAP_BASE_URL');
  const key = secret('EXTERNAL_MAP_API_KEY', mapMode === 'real' && auth === 'header');
  const keyHeader = text('EXTERNAL_MAP_API_KEY_HEADER', 'X-API-Key');
  if (!/^[A-Za-z0-9-]+$/.test(keyHeader) || ['host', 'content-length', 'connection', 'transfer-encoding'].includes(keyHeader.toLowerCase())) return invalid('EXTERNAL_MAP_API_KEY_HEADER');
  const vehicleTypes = text('SUPPORTED_VEHICLE_TYPES', 'MOCK_BIKE').split(',').map(s => s.trim());
  if (!vehicleTypes.length || new Set(vehicleTypes).size !== vehicleTypes.length || vehicleTypes.some(v => !/^[A-Za-z0-9_-]{1,32}$/.test(v))) return invalid('SUPPORTED_VEHICLE_TYPES');
  let rawProfiles: unknown;
  try { rawProfiles = JSON.parse(read(resolve(root, text('VEHICLE_PROFILES_FILE', 'config/vehicle-profiles.json')))); } catch { return invalid('VEHICLE_PROFILES_FILE'); }
  const source = checked(profilesSchema, rawProfiles, 'VEHICLE_PROFILES_FILE');
  const profiles: Record<string, Profile> = {};
  for (const vehicle of vehicleTypes) {
    const value = source.vehicleTypes[vehicle];
    if (!value?.profile) return invalid('VEHICLE_PROFILES_FILE');
    const effectiveUrl = value.baseUrl === null ? baseUrl : mapUrl(value.baseUrl, 'VEHICLE_PROFILES_FILE');
    if (mapMode === 'real' && (value.profile.startsWith('mock_') || !effectiveUrl)) return invalid('VEHICLE_PROFILES_FILE');
    profiles[vehicle] = { profile: value.profile, baseUrl: effectiveUrl };
  }
  const tokens = { trip: secret('ROUTING_TRIP_TOKEN', true), matching: secret('ROUTING_MATCHING_TOKEN', true), gateway: secret('ROUTING_GATEWAY_TOKEN', true) };
  if (new Set(Object.values(tokens)).size !== 3) return invalid('ROUTING_SERVICE_TOKENS');
  const realtimeUrl = text('REALTIME_BASE_URL');
  if (realtimeUrl) {
    let url: URL; try { url = new URL(realtimeUrl); } catch { return invalid('REALTIME_BASE_URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname) || (production && url.protocol !== 'https:')) return invalid('REALTIME_BASE_URL');
  }
  if (realtimeMode === 'real' && !realtimeUrl) return invalid('REALTIME_BASE_URL');
  const radius = integer('NEARBY_DRIVER_RADIUS_METERS', 2000, 2000); if (radius !== 2000) return invalid('NEARBY_DRIVER_RADIUS_METERS');
  return {
    production, host: checked(z.string().min(1).max(253).regex(/^[A-Za-z0-9.:-]+$/), text('HOST', '127.0.0.1'), 'HOST'),
    port: integer('PORT', 3004, 65535), swagger: boolean('SWAGGER_ENABLED', !production),
    logLevel: checked(z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']), text('LOG_LEVEL', 'INFO'), 'LOG_LEVEL'),
    tokens, vehicleTypes, profiles, map: { mode: mapMode, auth, key, keyHeader, baseUrl },
    realtime: { mode: realtimeMode, baseUrl: realtimeUrl.replace(/\/$/, ''), token: secret('REALTIME_TOKEN', realtimeMode === 'real'),
      timeout: integer('REALTIME_TIMEOUT_MS', 1000, 60000), maxResponse: integer('REALTIME_MAX_RESPONSE_BYTES', 1048576, 16777216), radius: 2000 },
    limits: {
      deadline: integer('REQUEST_DEADLINE_MS', 4000, 4999), upstreamTimeout: integer('UPSTREAM_TIMEOUT_MS', 1200, 60000),
      attempts: integer('UPSTREAM_MAX_ATTEMPTS', 2, 3), retryBase: integer('UPSTREAM_RETRY_BASE_MS', 100, 5000), maxResponse: integer('UPSTREAM_MAX_RESPONSE_BYTES', 1048576, 16777216),
      queueSize: integer('QUEUE_MAX_SIZE', 50, 10000), admissionTimeout: integer('QUEUE_ADMISSION_TIMEOUT_MS', 100, 5000), queueWait: integer('ROUTING_JOB_MAX_WAIT_MS', 500, 10000),
      workers: integer('WORKER_POOL_SIZE', 2, 32), rps: integer('RATE_LIMIT_REQUESTS_PER_SECOND', 2, 10000), burst: integer('RATE_LIMIT_BURST', 2, 10000),
      rateWait: integer('RATE_LIMIT_WAIT_TIMEOUT_MS', 250, 10000), elementsPerMinute: integer('RATE_LIMIT_MATRIX_ELEMENTS_PER_MINUTE', 100, 100000),
      matrixCandidates: integer('MATRIX_MAX_CANDIDATES', 50, 1000), matrixBatch: integer('MATRIX_BATCH_MAX_ELEMENTS', 25, 1000), shutdownGrace: integer('SHUTDOWN_GRACE_MS', 5000, 60000),
    },
  };
}
export function loadLocalEnvironment(root = process.cwd(), env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const file = resolve(root, '.env');
  return { ...(existsSync(file) ? parse(readFileSync(file)) : {}), ...env };
}
