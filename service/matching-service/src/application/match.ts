import { randomUUID } from 'node:crypto';
import type { Clients } from './ports';
import { Repository } from '../infrastructure/persistence';
import { rank, held, type Offer } from '../domain/models';
const OFFER_TTL_MS = 20000;
// A search with a PENDING offer is not re-checked every second: accept/decline and OfferExpiry make it due
// right away. Its own due time is only a safety net, set just after the offer expires (ADR-0008).
const OFFER_RECHECK_SLACK_MS = 500;
export class MatchDriver {
  /** `onEnqueued` runs after a transaction that queued an offer message commits, so the publisher can send it right away. */
  constructor(private readonly repo: Repository, private readonly clients: Clients, private readonly pollMs = 5000, private readonly onEnqueued: () => void = () => {}) {}
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
    const candidates = await this.clients.matrix(search.command), tried = await this.repo.tried(tripId);
    const reservations = await this.repo.reservations(candidates.map(c => c.driverId));
    for (const c of rank(candidates, tried, new Set(reservations.filter(r => r.tripId !== null).map(r => r.driverId)), Date.now())) {
      if (Date.now() - started > 30000) throw new Error('MATCHING_JOB_DEADLINE');
      const eligible = await this.clients.driver(c.driverId, search.command.vehicleType);
      if (!eligible.profileEligible || eligible.desiredStatus !== 'ONLINE' || !eligible.vehicleId || !eligible.driverSnapshot || !eligible.vehicleSnapshot || eligible.vehicleSnapshot.vehicleType !== search.command.vehicleType) continue;
      const created = await this.repo.transaction(async tx => {
        const s = await tx.search(tripId); if (!s || s.status !== 'SEARCHING' || s.offerId) return false;
        await tx.lock('driver:' + c.driverId);
        const reserved: unknown[] = await tx.db.query('SELECT 1 FROM matching_reservations WHERE driver_id=$1', [c.driverId]); if (reserved.length) return false;
        const previous: unknown[] = await tx.db.query('SELECT 1 FROM matching_offers WHERE trip_id=$1 AND driver_id=$2', [tripId, c.driverId]); if (previous.length) return false;
        const now = await tx.now(); if (now - Date.parse(c.observedAt) > 30000) return false;
        const o: Offer = { offerId: randomUUID(), tripId, driverId: c.driverId, version: 1, status: 'PENDING', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + OFFER_TTL_MS).toISOString(), command: search.command!, assignment: { eventId: randomUUID(), driverId: c.driverId, vehicleId: eligible.vehicleId!, driverSnapshot: eligible.driverSnapshot!, vehicleSnapshot: eligible.vehicleSnapshot! } };
        await tx.saveOffer(o); if (!await tx.reserve(o)) throw new Error('RESERVATION_CONFLICT');
        s.offerId = o.offerId; s.attempts = 0; await tx.saveSearch(s, OFFER_TTL_MS + OFFER_RECHECK_SLACK_MS); await tx.enqueue(o); return true;
      });
      if (created) { this.onEnqueued(); return; }
    }
    await this.repo.transaction(async tx => { const s = await tx.search(tripId); if (s?.status === 'SEARCHING' && !s.offerId) await tx.saveSearch(s, this.pollMs); });
  }
}
export function publicOffer(o: Offer | null) {
  if (!o) return null;
  return { offerId: o.offerId, tripId: o.tripId, driverId: o.driverId, version: o.version, status: o.status, expiresAt: o.expiresAt, pickup: o.command.pickup, destination: o.command.destination, vehicleType: o.command.vehicleType, fare: o.command.fare };
}
export function deliverable(o: Offer | null, now = Date.now()) { return o && held(o.status) && (o.status !== 'PENDING' || now < Date.parse(o.expiresAt)); }
