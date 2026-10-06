import { z } from 'zod';
import { driverSchema, locationSchema } from '../domain/models';
import {navigationRouteSchema} from '../domain/navigation';
const amount = z.number().int().min(0).max(2147483647);
const summary = z.object({ distanceMeters: amount, durationSeconds: amount }).strict();
export const summaryResponse = summary;
export const routeResponse = summary.extend({ vehicleType: z.string(), polyline: z.object({ encoding: z.literal('encoded_polyline'), precision: z.literal(6), value: z.string() }),
  steps: z.array(summary.extend({ streetName: z.string().nullable(), instruction: z.null(), maneuver: z.object({ type: z.string(), modifier: z.string().nullable(), location: locationSchema, exit: z.number().int().positive().nullable() }) })), calculatedAt: z.iso.datetime() });
export const matrixResponse = z.object({ entries: z.array(z.union([driverSchema.extend({ status: z.literal('OK'), distanceMeters: amount, durationSeconds: amount }), driverSchema.extend({ status: z.literal('NO_ROUTE'), distanceMeters: z.null(), durationSeconds: z.null() })])), radiusMeters: z.literal(2000), hasReachableCandidate: z.boolean(), calculatedAt: z.iso.datetime() });
export const envelopeSchema = (data: z.ZodType) => z.object({ data, meta: z.object({ requestId: z.uuid() }) });
export const navigationResponse=z.object({schemaVersion:z.literal(1),provider:z.literal('OSRM'),geometryPrecision:z.literal(6),vehicleType:z.string(),calculatedAt:z.iso.datetime(),route:navigationRouteSchema});
