import { z } from 'zod';
import { locationSchema } from './models';
import { RoutingError } from './errors';
const vehicleType = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
export const estimateSchema = z.object({ pickup: locationSchema, destination: locationSchema, vehicleType }).strict();
export const routeRequestSchema = z.object({ origin: locationSchema, destination: locationSchema, vehicleType, includeSteps: z.boolean().default(false) }).strict();
export const matrixRequestSchema = z.object({ pickup: locationSchema, vehicleType }).strict();
export const recalculateSchema = z.object({ currentLocation: locationSchema, destination: locationSchema, vehicleType, includeSteps: z.boolean().default(false) }).strict();
export function request<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value); if (!parsed.success) throw new RoutingError('INVALID_REQUEST', 400); return parsed.data;
}
