import { Repository, Tx } from '../infrastructure/persistence';
import { terminal, type Command, type Search } from '../domain/models';
export async function close(tx: Tx, search: Search, status: 'CANCELLED' | 'COMPLETED') {
  if (terminal(search.status)) return;
  if (search.offerId) { const o = await tx.offer(search.offerId); if (o) { o.status = 'REVOKED'; o.version++; await tx.saveOffer(o); await tx.release(o); await tx.enqueue(o); } }
  search.status = status; await tx.saveSearch(search);
}
export class Commands {
  constructor(private readonly repo: Repository) {}
  search(command: Command) {
    return this.repo.transaction(tx => tx.receipt('command:' + command.commandId, command, async () => {
      await tx.lock('search:' + command.tripId); const existing = await tx.search(command.tripId);
      if (!existing) await tx.saveSearch({ tripId: command.tripId, status: 'SEARCHING', command, offerId: null, attempts: 0 });
      return { commandId: command.commandId, accepted: true as const };
    }));
  }
  stop(id: string, tripId: string, input: unknown, status: 'CANCELLED' | 'COMPLETED') {
    return this.repo.transaction(tx => tx.receipt('command:' + id, input, async () => {
      await tx.lock('search:' + tripId); const search = await tx.search(tripId);
      if (search) await close(tx, search, status);
      else await tx.saveSearch({ tripId, status, command: null, offerId: null, attempts: 0 });
      return status === 'COMPLETED' ? { eventId: id, accepted: true as const } : { commandId: id, accepted: true as const };
    }));
  }
}
