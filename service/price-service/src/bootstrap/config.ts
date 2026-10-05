import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { policySchema, type FarePolicyConfig } from '../domain/fare';
export interface Config { host: string; port: number; token: string; vehicles: string[]; policy: FarePolicyConfig; swagger: boolean }
export function loadConfig(env: NodeJS.ProcessEnv = process.env, read: (file: string) => string = file => readFileSync(file, 'utf8')): Config {
  const invalid = (name: string): never => { throw new Error('Invalid configuration: ' + name); };
  const inline = env.PRICE_TRIP_TOKEN?.trim(); const file = env.PRICE_TRIP_TOKEN_FILE?.trim(); if (inline && file) invalid('PRICE_TRIP_TOKEN');
  let token = inline ?? ''; if (file) { try { token = read(resolve(file)).trim(); } catch { invalid('PRICE_TRIP_TOKEN'); } }
  if (!token || /[^\x21-\x7e]/.test(token)) invalid('PRICE_TRIP_TOKEN');
  const raw = env.PORT ?? '3005'; const port = Number(raw); if (!/^\d+$/.test(raw) || !Number.isInteger(port) || port < 1 || port > 65535) invalid('PORT');
  const host = env.HOST ?? '127.0.0.1'; if (!/^[A-Za-z0-9.:-]+$/.test(host)) invalid('HOST');
  const vehicles = (env.SUPPORTED_VEHICLE_TYPES ?? 'CAR,BIKE').split(',').map(v => v.trim());
  if (vehicles.some(v => !/^[A-Za-z0-9_-]{1,32}$/.test(v)) || new Set(vehicles).size !== vehicles.length || (env.NODE_ENV === 'production' && vehicles.includes('MOCK_BIKE'))) invalid('SUPPORTED_VEHICLE_TYPES');
  let source: unknown; try { source = JSON.parse(read(resolve(env.FARE_POLICY_FILE ?? 'config/fare-policy.example.json'))); } catch { invalid('FARE_POLICY_FILE'); }
  const parsed = policySchema.safeParse(source); if (!parsed.success || vehicles.some(v => !parsed.data.vehicleTypes[v])) return invalid('FARE_POLICY_FILE');
  if (env.SWAGGER_ENABLED && !['true', 'false'].includes(env.SWAGGER_ENABLED)) invalid('SWAGGER_ENABLED');
  return { token, port, host, vehicles, policy: parsed.data, swagger: env.NODE_ENV !== 'production' && env.SWAGGER_ENABLED === 'true' };
}
