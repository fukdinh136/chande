import { randomUUID } from 'node:crypto';
import { Repository } from '../infrastructure/persistence';
import { UpstreamError } from '../infrastructure/clients';
import { deadlineOf, pastDeadline, terminal, type Search } from '../domain/models';
import type { Clients } from './ports';
import { close } from './commands';
import { countTimeout } from './metrics';
// A timed-out search whose cancellation is in flight stays due again after this, as a safety net if the job dies.
const RETRY_SAFETY_MS = 5000;
/**
 * Ends a search that passed its deadline with no offer pending (ADR-0004): Trip cancels the trip as NO_DRIVER_FOUND,
 * then the search is closed here. Trip decides; Matching never closes a search Trip still has as SEARCHING.
 * A pending offer is never cut short: it runs its 20 seconds, and an accept in that window still assigns the trip.
 */
export class SearchTimeout {
  /** `timeoutMs` (SEARCH_TIMEOUT_MS) only dates searches stored before ADR-0004; newer ones carry their deadline. */
  constructor(private readonly repo: Repository, private readonly clients: Pick<Clients, 'noDriver' | 'trip'>, private readonly timeoutMs = 180000) {}
  deadline(s: Search) { return deadlineOf(s, this.timeoutMs); }
  passed(s: Search, now: number) { return pastDeadline(s, now, this.timeoutMs); }
  async execute(tripId: string) {
    // Fix the idempotency key in the same transaction that checks the search, so every retry sends the same one.
    const eventId = await this.repo.transaction(async tx => {
      const s = await tx.search(tripId);
      if (!s || s.status !== 'SEARCHING' || s.offerId || !this.passed(s, await tx.now())) return null;
      if (!s.timeoutEventId) { s.timeoutEventId = randomUUID(); await tx.saveSearch(s, RETRY_SAFETY_MS); }
      return s.timeoutEventId;
    });
    if (!eventId) return;
    try { await this.clients.noDriver(tripId, eventId); }
    catch (error) {
      // 409: the trip left SEARCHING (cancelled by the rider, for example). Anything else is retried with the same key.
      if (!(error instanceof UpstreamError && [404, 409].includes(error.status))) throw error;
    }
    const state = await this.clients.trip(tripId);
    if (state.status === 'SEARCHING') throw new UpstreamError(503, 'TRIP_STILL_SEARCHING', 'trip');
    const settled = await this.repo.transaction(async tx => {
      const s = await tx.search(tripId); if (!s || terminal(s.status) || s.offerId) return false;
      await close(tx, s, state.status === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED'); return true;
    });
    if (settled) countTimeout(state.status === 'CANCELLED' ? 'cancelled' : 'settled');
  }
}
