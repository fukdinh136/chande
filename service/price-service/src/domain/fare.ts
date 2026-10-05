import { z } from 'zod';
const maxMoney = 9223372036854775807n;
const money = z.string().regex(/^(0|[1-9]\d*)$/).max(19).refine(v => /^\d{1,19}$/.test(v) && BigInt(v) <= maxMoney);
export const policySchema = z.object({ schemaVersion: z.literal(1), currency: z.literal('VND'), billingBasis: z.literal('distance'), vehicleTypes: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), z.object({ openingFareVnd: money, includedDistanceMeters: z.number().int().min(0).max(2147483647), pricePerKmVnd: money }).strict()) }).strict();
export type FarePolicyConfig = z.infer<typeof policySchema>;
export const requestSchema = z.object({ route: z.object({ distanceMeters: z.number().int().min(0).max(2147483647), durationSeconds: z.number().int().min(0).max(2147483647) }).strict(), vehicleType: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/) }).strict();
export class FareError extends Error { constructor(public readonly code: 'INVALID_REQUEST' | 'UNSUPPORTED_VEHICLE_TYPE' | 'INVALID_FARE' | 'INVALID_SERVICE_CREDENTIAL', public readonly status: number) { super(code); } }
export class FarePolicy {
  private readonly policy: FarePolicyConfig;
  constructor(config: unknown) { this.policy = policySchema.parse(structuredClone(config)); }
  calculate(input: z.infer<typeof requestSchema>) {
    const rule = this.policy.vehicleTypes[input.vehicleType]; if (!rule) throw new FareError('UNSUPPORTED_VEHICLE_TYPE', 400);
    const meters = BigInt(Math.max(0, input.route.distanceMeters - rule.includedDistanceMeters));
    const base = BigInt(rule.openingFareVnd); const distance = (meters * BigInt(rule.pricePerKmVnd) + 999n) / 1000n;
    const total = base + distance; if (total > maxMoney) throw new FareError('INVALID_FARE', 503);
    return { currency: 'VND' as const, amount: String(total), breakdown: [{ code: 'BASE_FARE', amount: String(base) }, { code: 'DISTANCE_FARE', amount: String(distance) }] };
  }
}
