import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Principal } from '../../domain/models';
import { DomainError } from '../../domain/error';
import { Trip } from '../../domain/trip';
import type { PageKey, Store } from '../ports/store';
export class HistoryCursor {
  constructor(private readonly secret: string) {}
  private signature(value: string): string { return createHmac('sha256', this.secret).update(value).digest('base64url'); }
  encode(key: PageKey, principal: Principal, status?: string): string { const value = Buffer.from(JSON.stringify({ ...key, principal, status: status ?? null })).toString('base64url'); return `${value}.${this.signature(value)}`; }
  decode(token: string, principal: Principal, status?: string): PageKey {
    try {
      const pieces = token.split('.'); if (pieces.length !== 2 || token.length > 2048) throw new Error();
      const [value, signature] = pieces as [string, string]; const expected = Buffer.from(this.signature(value)); const actual = Buffer.from(signature);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error();
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString()) as { requestedAt: string; tripId: string; principal: Principal; status: string | null };
      if (parsed.principal.sub !== principal.sub || parsed.principal.role !== principal.role || parsed.status !== (status ?? null) || !Number.isFinite(Date.parse(parsed.requestedAt)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.tripId)) throw new Error();
      return { requestedAt: parsed.requestedAt, tripId: parsed.tripId };
    } catch { throw new DomainError('INVALID_CURSOR'); }
  }
}
export class GetTrip {
  constructor(private readonly store: Store, private readonly cursor: HistoryCursor) {}
  detail(principal: Principal, id: string) {
    return this.store.transaction(async tx => {
      const data = await tx.findTrip(id); if (!data) throw new DomainError('RESOURCE_NOT_FOUND'); Trip.restore(data).requireRead(principal);
      return { trip: data, statusHistory: (await tx.history(id)).filter(entry => entry.version <= data.version) };
    });
  }
  active(principal: Principal) { return this.store.transaction(tx => tx.active(principal)); }
  async list(principal: Principal, limit = 20, status?: string, cursor?: string) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (status && !['COMPLETED', 'CANCELLED'].includes(status))) throw new DomainError('INVALID_REQUEST');
    const key = cursor ? this.cursor.decode(cursor, principal, status) : undefined;
    return this.store.transaction(async tx => {
      const rows = await tx.list(principal, limit + 1, status, key); const items = rows.slice(0, limit); const last = items.at(-1);
      return { items, nextCursor: rows.length > limit && last ? this.cursor.encode({ requestedAt: last.timestamps.requestedAt, tripId: last.tripId }, principal, status) : null };
    });
  }
}
