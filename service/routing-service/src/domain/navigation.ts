import { z } from 'zod';
const amount = z.number().finite().nonnegative().max(2147483647);
const coordinate = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const maneuver = z.object({ type: z.string().min(1), location: coordinate, modifier: z.string().optional(), bearing_before: z.number().min(0).max(360), bearing_after: z.number().min(0).max(360), exit: z.number().int().positive().optional() });
const intersection = z.object({ location: coordinate, bearings: z.array(z.number()), entry: z.array(z.boolean()), in: z.number().int().nonnegative().optional(), out: z.number().int().nonnegative().optional(), classes: z.array(z.string()).optional() });
export const navigationRouteSchema = z.object({
  geometry: z.string().min(1), distance: amount, duration: amount,
  legs: z.array(z.object({ distance: amount, duration: amount, summary: z.string(), steps: z.array(z.object({ geometry: z.string().min(1), distance: amount, duration: amount, name: z.string(), mode: z.string().optional(), driving_side: z.string().optional(), maneuver, intersections: z.array(intersection).optional() })).min(2) })).min(1),
});
export type NavigationRoute = z.infer<typeof navigationRouteSchema>;
