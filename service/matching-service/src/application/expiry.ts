import { Repository } from '../infrastructure/persistence';
/** Separate sweep so an upstream matrix/Driver call cannot postpone the expiry boundary. */
export class OfferExpiry {
  private busy = false;
  constructor(private readonly repo: Repository) {}
  async tick() {
    if (this.busy) return; this.busy = true;
    try {
      const rows: { trip_id: string; id: string }[] = await this.repo.db.query("SELECT trip_id,id FROM matching_offers WHERE status='PENDING' AND expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 100");
      for (const row of rows) await this.repo.transaction(async tx => {
        const search = await tx.search(row.trip_id); if (!search || search.status !== 'SEARCHING' || search.offerId !== row.id) return;
        const offer = await tx.offer(row.id); if (!offer || offer.status !== 'PENDING' || await tx.now() < Date.parse(offer.expiresAt)) return;
        offer.status = 'EXPIRED'; offer.version++; await tx.saveOffer(offer); await tx.release(offer); await tx.enqueue(offer); search.offerId = null; await tx.saveSearch(search);
      });
    } finally { this.busy = false; }
  }
}
