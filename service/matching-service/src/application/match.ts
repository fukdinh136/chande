import { randomUUID } from 'node:crypto';
import type { CandidateSource } from './ports';
import { Repository } from '../infrastructure/persistence';
import { held, type Offer } from '../domain/models';
import type { SearchTimeout } from './timeout';
const OFFER_TTL_MS = 20000;
// A search with a PENDING offer is not re-checked every second: accept/decline and OfferExpiry make it due
// right away. Its own due time is only a safety net, set just after the offer expires (ADR-0008).
const OFFER_RECHECK_SLACK_MS = 500;
export class MatchDriver {
  /** `source` finds and ranks candidates (ADR-0001). `onEnqueued` runs after a transaction that queued an offer message
   * commits, so the publisher can send it right away. `timeout` ends a search past its deadline (ADR-0004); without it
   * a search never times out. */
  constructor(private readonly repo: Repository, private readonly source: CandidateSource, private readonly pollMs = 5000, private readonly onEnqueued: () => void = () => {}, private readonly timeout?: SearchTimeout) {}
  async execute(tripId: string) {
    const started = Date.now();
    const search = await this.repo.getSearch(tripId); if (!search || search.status !== 'SEARCHING' || !search.command) return;
    if (search.offerId) {
      const expired = await this.repo.transaction(async tx => {
        const s = await tx.search(tripId); if (!s || s.status !== 'SEARCHING' || !s.offerId) return false;
        const o = await tx.offer(s.offerId); if (!o || o.status !== 'PENDING') return false;
        const now = await tx.now(); if (now < Date.parse(o.expiresAt)) { await tx.saveSearch(s, Date.parse(o.expiresAt) - now + OFFER_RECHECK_SLACK_MS); return false; }
        o.status = 'EXPIRED'; o.version++; await tx.saveOffer(o); await tx.release(o); await tx.enqueue(o); s.offerId = null; await tx.saveSearch(s); return true;
      });
      if (expired) this.onEnqueued();
      return;
    }
    // Past the deadline with no offer pending: no new offer, end the search instead (ADR-0004).
    if (this.timeout?.passed(search, Date.now())) { await this.timeout.execute(tripId); return; }
    const exclude = async (ids: string[]) => {
      const tried = await this.repo.tried(tripId), reservations = await this.repo.reservations(ids);
      return new Set([...tried, ...reservations.filter(r => r.tripId !== null).map(r => r.driverId)]);
    };
    for (const { candidate: c, eligibility } of await this.source.find(search.command, exclude)) {
      if (Date.now() - started > 30000) throw new Error('MATCHING_JOB_DEADLINE');
      const eligible = await eligibility();
      if (!eligible.profileEligible || eligible.desiredStatus !== 'ONLINE' || !eligible.vehicleId || !eligible.driverSnapshot || !eligible.vehicleSnapshot || eligible.vehicleSnapshot.vehicleType !== search.command.vehicleType) continue;
      const created = await this.repo.transaction(async tx => {
        const s = await tx.search(tripId); if (!s || s.status !== 'SEARCHING' || s.offerId) return false;
        if (this.timeout?.passed(s, await tx.now())) return 'deadline' as const;
        await tx.lock('driver:' + c.driverId);
        // One statement after the driver lock: its snapshot is taken once the lock is held.
        const checks: { now: Date; reserved: boolean; previous: boolean }[] = await tx.db.query('SELECT clock_timestamp() AS now, EXISTS(SELECT 1 FROM matching_reservations WHERE driver_id=$1) AS reserved, EXISTS(SELECT 1 FROM matching_offers WHERE trip_id=$2 AND driver_id=$1) AS previous', [c.driverId, tripId]);
        const check = checks[0]!; if (check.reserved || check.previous) return false;
        const now = check.now.getTime(); if (now - Date.parse(c.observedAt) > 30000) return false;
        const o: Offer = { offerId: randomUUID(), tripId, driverId: c.driverId, version: 1, status: 'PENDING', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + OFFER_TTL_MS).toISOString(), command: search.command!, assignment: { eventId: randomUUID(), driverId: c.driverId, vehicleId: eligible.vehicleId!, driverSnapshot: eligible.driverSnapshot!, vehicleSnapshot: eligible.vehicleSnapshot! } };
        await tx.saveOffer(o); if (!await tx.reserve(o)) throw new Error('RESERVATION_CONFLICT');
        s.offerId = o.offerId; s.attempts = 0; await tx.saveSearch(s, OFFER_TTL_MS + OFFER_RECHECK_SLACK_MS); await tx.enqueue(o); return true;
      });
      if (created === 'deadline') break;
      if (created) { this.onEnqueued(); return; }
    }
    // Search again after pollMs, or at the deadline if that comes first, so the timeout is not late by a whole poll.
    await this.repo.transaction(async tx => {
      const s = await tx.search(tripId); if (s?.status !== 'SEARCHING' || s.offerId) return;
      const deadline = this.timeout?.deadline(s) ?? null, untilDeadline = deadline === null ? Infinity : Math.max(0, deadline - await tx.now());
      await tx.saveSearch(s, Math.min(this.pollMs, untilDeadline));
    });
  }
}
export function publicOffer(o: Offer | null) {
  if (!o) return null;
  return { offerId: o.offerId, tripId: o.tripId, driverId: o.driverId, version: o.version, status: o.status, expiresAt: o.expiresAt, pickup: o.command.pickup, destination: o.command.destination, vehicleType: o.command.vehicleType, fare: o.command.fare };
}
export function deliverable(o: Offer | null, now = Date.now()) { return o && held(o.status) && (o.status !== 'PENDING' || now < Date.parse(o.expiresAt)); }
