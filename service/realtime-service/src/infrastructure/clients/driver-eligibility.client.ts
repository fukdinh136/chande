import { EligibilityProvider, Eligibility } from '../../application/ports/eligibility-provider.port';
import { VehicleType, VEHICLE_TYPES } from '../../domain/policies/nearby.policy';
import { RealtimeError } from '../../domain/errors';
export class DriverEligibilityClient implements EligibilityProvider {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly timeoutMs: number) {}
  async find(ids: readonly string[], vehicleType?: VehicleType): Promise<Eligibility[]> {
    const result: Eligibility[] = [];
    const signal = AbortSignal.timeout(this.timeoutMs);
    // One HTTP request per batch, not per driver. Driver caps batches at 100.
    for (let offset = 0; offset < ids.length; offset += 100) {
      const driverIds = ids.slice(offset, offset + 100);
      try {
        const response = await fetch(`${this.baseUrl}/internal/drivers/eligibility/batch`, {
          method: 'POST', redirect: 'error', signal,
          headers: { 'Content-Type': 'application/json', 'X-Service-Token': this.token },
          body: JSON.stringify({ driverIds, ...(vehicleType ? { vehicleType } : {}) }),
        });
        if (!response.ok) throw new RealtimeError('DEPENDENCY_UNAVAILABLE');
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object' || !('data' in body) || !body.data || typeof body.data !== 'object' || !('items' in body.data) || !Array.isArray(body.data.items) ||
            !('meta' in body) || !body.meta || typeof body.meta !== 'object' || !('requestId' in body.meta) || typeof body.meta.requestId !== 'string')
          throw new RealtimeError('DEPENDENCY_UNAVAILABLE');
        const items: Eligibility[] = [];
        const seen = new Set<string>();
        for (const raw of body.data.items as unknown[]) {
          if (!raw || typeof raw !== 'object') throw new RealtimeError('DEPENDENCY_UNAVAILABLE');
          const item = raw as Record<string, unknown>;
          if (typeof item.driverId !== 'string' || !driverIds.includes(item.driverId) || seen.has(item.driverId) ||
              typeof item.eligible !== 'boolean' || typeof item.availabilityKnown !== 'boolean' ||
              !(item.vehicleType === null || VEHICLE_TYPES.includes(item.vehicleType as VehicleType)) ||
              (item.eligible && (!item.availabilityKnown || item.vehicleType === null || item.profileEligible !== true || item.operationalStatus !== 'AVAILABLE')))
            throw new RealtimeError('DEPENDENCY_UNAVAILABLE');
          seen.add(item.driverId);
          items.push({ driverId: item.driverId, eligible: item.eligible, availabilityKnown: item.availabilityKnown, vehicleType: item.vehicleType as VehicleType | null });
        }
        if (seen.size !== driverIds.length) throw new RealtimeError('DEPENDENCY_UNAVAILABLE');
        result.push(...items);
      } catch { throw new RealtimeError('DEPENDENCY_UNAVAILABLE'); }
    }
    return result;
  }
}
