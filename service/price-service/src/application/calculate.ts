import { FareError, FarePolicy, requestSchema } from '../domain/fare';
export class CalculateFare {
  constructor(private readonly policy: FarePolicy, private readonly vehicles: readonly string[]) {}
  execute(value: unknown) {
    const parsed = requestSchema.safeParse(value); if (!parsed.success) throw new FareError('INVALID_REQUEST', 400);
    if (!this.vehicles.includes(parsed.data.vehicleType)) throw new FareError('UNSUPPORTED_VEHICLE_TYPE', 400);
    return this.policy.calculate(parsed.data);
  }
}
