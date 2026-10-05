import { Repository, hash } from '../infrastructure/persistence';
import { decide, MatchingError, terminal, type Offer } from '../domain/models';
import type { Clients } from './ports';
import { UpstreamError } from '../infrastructure/clients';
import { close } from './commands';
import { publicOffer } from './match';
export class OfferDecisions {
  constructor(private readonly repo: Repository) {}
  async execute(offerId: string, driverId: string, key: string, action: 'accept' | 'decline') {
    const initial = await this.repo.getOffer(offerId); if (!initial) throw new MatchingError('NOT_FOUND', 404); if (initial.driverId !== driverId) throw new MatchingError('FORBIDDEN', 403);
    return this.repo.transaction(tx => tx.receipt(`decision:${driverId}:${key}`, { offerId, action }, async () => {
      const s = await tx.search(initial.tripId), o = await tx.offer(offerId); if (!s || !o) throw new MatchingError('NOT_FOUND', 404);
      o.status = decide(o, s, driverId, action, await tx.now()); o.version++; await tx.saveOffer(o); await tx.enqueue(o);
      if (action === 'accept') s.status = 'ASSIGNMENT_PENDING'; else { await tx.release(o); s.offerId = null; }
      await tx.saveSearch(s); return { offerId, status: o.status, accepted: action === 'accept' };
    }));
  }
  async get(offerId: string, driverId: string) { const o = await this.repo.getOffer(offerId); if (!o) throw new MatchingError('NOT_FOUND', 404); if (o.driverId !== driverId) throw new MatchingError('FORBIDDEN', 403); return publicOffer(o); }
}
export class AssignDriver {
  constructor(private readonly repo: Repository, private readonly clients: Clients) {}
  async execute(tripId: string) {
    const s = await this.repo.getSearch(tripId); if (!s || s.status !== 'ASSIGNMENT_PENDING' || !s.offerId) return;
    const o = await this.repo.getOffer(s.offerId); if (!o || o.status !== 'ASSIGNMENT_PENDING') return;
    // Reconcile first: a previous callback can already have committed or Trip may be terminal.
    const state = await this.clients.trip(tripId);
    if (state.status !== 'SEARCHING') { await this.reconcile(o, state.status, state.driverId); return; }
    if (!o.assignmentAttempted) {
      const driver = await this.clients.driver(o.driverId, o.command.vehicleType);
      if (!driver.profileEligible || driver.desiredStatus !== 'ONLINE' || driver.vehicleId !== o.assignment.vehicleId || hash(driver.driverSnapshot) !== hash(o.assignment.driverSnapshot) || hash(driver.vehicleSnapshot) !== hash(o.assignment.vehicleSnapshot)) { await this.reject(o); return; }
    }
    // Local terminal can arrive during HTTP reads. No callback after observing it.
    const allowed = await this.repo.transaction(async tx => { const s = await tx.search(tripId); if (s?.status !== 'ASSIGNMENT_PENDING' || s.offerId !== o.offerId) return false; const current = await tx.offer(o.offerId); if (!current || current.status !== 'ASSIGNMENT_PENDING') return false; current.assignmentAttempted = true; await tx.saveOffer(current); return true; });
    if (!allowed) return;
    try { await this.clients.assign(tripId, o.assignment); }
    catch (error) {
      const latest = await this.clients.trip(tripId);
      if (latest.status !== 'SEARCHING') { await this.reconcile(o, latest.status, latest.driverId); return; }
      if (error instanceof UpstreamError && [400, 404, 409, 422].includes(error.status)) { await this.reject(o); return; }
      throw error; // Keep reservation on uncertain network/503. Retry the frozen event/payload.
    }
    const latest = await this.clients.trip(tripId); await this.reconcile(o, latest.status, latest.driverId);
  }
  private async reject(o: Offer) {
    await this.repo.transaction(async tx => { const s = await tx.search(o.tripId); if (!s || terminal(s.status) || s.status !== 'ASSIGNMENT_PENDING' || s.offerId !== o.offerId) return;
      const current = await tx.offer(o.offerId); if (!current) return; current.status = 'REJECTED'; current.version++; await tx.saveOffer(current); await tx.release(current); await tx.enqueue(current); s.status = 'SEARCHING'; s.offerId = null; s.attempts = 0; await tx.saveSearch(s);
    });
  }
  private async reconcile(o: Offer, status: string, driverId: string | null) {
    await this.repo.transaction(async tx => {
      const s = await tx.search(o.tripId); if (!s || terminal(s.status) || s.offerId !== o.offerId) return;
      if (status === 'CANCELLED' || status === 'COMPLETED') { await close(tx, s, status); return; }
      if (['ASSIGNED','DRIVER_ARRIVED','IN_PROGRESS'].includes(status) && driverId === o.driverId) {
        const current = await tx.offer(o.offerId); if (!current) return; current.status = 'ASSIGNED'; current.version++; await tx.saveOffer(current); await tx.enqueue(current); s.status = 'ASSIGNED'; s.attempts = 0; await tx.saveSearch(s);
      } else if (status !== 'SEARCHING') { await close(tx, s, 'CANCELLED'); }
    });
  }
}
