import { randomUUID } from 'node:crypto';
import { Occupancy } from '../../application/ports/occupancy.port';
import { DriverError } from '../../domain/value-objects/error';
import { CircuitBreaker, failedStatus, type BreakerOptions } from '../circuit-breaker';
export class HttpOccupancy implements Occupancy {
  /** Breakers for Trip and Matching (D1): while one is open, lookups fail at once instead of waiting for the timeout. */
  readonly breakers: { trip: CircuitBreaker; matching: CircuitBreaker };
  constructor(private readonly tripUrl: string, private readonly tripToken: string, private readonly matchingUrl: string, private readonly matchingToken: string, private readonly timeout: number, breakerOptions: BreakerOptions = {}) {
    this.breakers = { trip: new CircuitBreaker('trip', breakerOptions), matching: new CircuitBreaker('matching', breakerOptions) };
  }
  async lookup(ids: readonly string[]) {
    const signal = AbortSignal.timeout(this.timeout), requestId = randomUUID();
    const call = async (url: string, path: string, token: string, breaker: CircuitBreaker) => {
      if (breaker.acquire() > 0) throw new DriverError('DEPENDENCY_UNAVAILABLE');
      let r: Response;
      try { r = await fetch(url + path, { method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/json', 'X-Service-Token': token, 'X-Request-Id': requestId }, body: JSON.stringify({ driverIds: ids }) }); }
      catch (error) { breaker.failure(); throw error; }
      if (failedStatus(r.status, r.headers.get('retry-after'))) breaker.failure(); else breaker.success();
      if (!r.ok) throw new DriverError('DEPENDENCY_UNAVAILABLE');
      const text = await r.text(); if (text.length > 100000) throw new DriverError('DEPENDENCY_UNAVAILABLE');
      const raw = JSON.parse(text) as { data?: { items?: { driverId: string; tripId: string | null }[] } };
      const rows = raw.data?.items;
      if (!Array.isArray(rows) || rows.length !== ids.length || new Set(rows.map(r => r.driverId)).size !== ids.length || rows.some(r => !ids.includes(r.driverId) || !(r.tripId === null || typeof r.tripId === 'string' && /^[0-9a-f-]{36}$/i.test(r.tripId)))) throw new DriverError('DEPENDENCY_UNAVAILABLE');
      return rows;
    };
    try {
      const [trips, reservations] = await Promise.all([call(this.tripUrl, '/internal/trips/active-drivers/batch', this.tripToken, this.breakers.trip), call(this.matchingUrl, '/internal/matching/reservations/batch', this.matchingToken, this.breakers.matching)]);
      return new Map(ids.map(id => [id, trips.some(r => r.driverId === id && r.tripId !== null) || reservations.some(r => r.driverId === id && r.tripId !== null)]));
    } catch { throw new DriverError('DEPENDENCY_UNAVAILABLE'); }
  }
}
