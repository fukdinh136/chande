import { z } from 'zod';
import { locationSchema } from './models';
import { RoutingError } from './errors';
const vehicleType = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
export const estimateSchema = z.object({ pickup: locationSchema, destination: locationSchema, vehicleType }).strict();
export const routeRequestSchema = z.object({ origin: locationSchema, destination: locationSchema, vehicleType, includeSteps: z.boolean().default(false) }).strict();
export const matrixRequestSchema = z.object({ pickup: locationSchema, vehicleType }).strict();
// ADR-0001: Matching sends the origins it already chose; Routing only measures them.
const origin = z.object({ id: z.string().min(1).max(128).refine(id => id.trim() === id), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict();
export const etaMatrixRequestSchema = z.object({ destination: locationSchema, vehicleType, origins: z.array(origin).min(1).max(50).refine(list => new Set(list.map(o => o.id)).size === list.length) }).strict();
export const recalculateSchema = z.object({ currentLocation: locationSchema, destination: locationSchema, vehicleType, includeSteps: z.boolean().default(false) }).strict();
export function request<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value); if (!parsed.success) throw new RoutingError('INVALID_REQUEST', 400); return parsed.data;
}
