import type { DataSource, EntityManager } from 'typeorm';
import { DomainError } from '../../domain/error';
import type { HistoryEntry, Principal, Quote, TripData } from '../../domain/models';
import type { Destination, OutboxMessage, PageKey, Receipt, Store, Transaction } from '../../application/ports/store';

type DataRow<T> = { data: T };
class PgTransaction implements Transaction {
  constructor(private readonly db: EntityManager) {}
  async findTrip(id: string, lock = false): Promise<TripData | null> {
    const rows: DataRow<TripData>[] = await this.db.query(`SELECT data FROM trips WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
    return rows[0]?.data ?? null;
  }
  async saveTrip(trip: TripData, expectedVersion?: number): Promise<void> {
    const params = [trip.tripId, trip.quoteId, trip.riderId, trip.driverId, trip.vehicleId, trip.status, trip.version, trip.timestamps.requestedAt, trip.fare.estimatedAmount, trip.fare.finalAmount, trip];
    if (expectedVersion === undefined) {
      await this.db.query('INSERT INTO trips(id,quote_id,rider_id,driver_id,vehicle_id,status,version,requested_at,estimated_fare,final_fare,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', params);
    } else {
      const [rows]: [{ id: string }[], number] = await this.db.query('UPDATE trips SET driver_id=$1,vehicle_id=$2,status=$3,version=$4,final_fare=$5,data=$6 WHERE id=$7 AND version=$8 RETURNING id', [trip.driverId, trip.vehicleId, trip.status, trip.version, trip.fare.finalAmount, trip, trip.tripId, expectedVersion]);
      if (!rows.length) throw new DomainError('VERSION_CONFLICT');
    }
  }
  async findQuote(id: string, lock = false): Promise<Quote | null> {
    const rows: DataRow<Quote>[] = await this.db.query(`SELECT data FROM trip_quotes WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
    return rows[0]?.data ?? null;
  }
  async saveQuote(quote: Quote): Promise<void> { await this.db.query('INSERT INTO trip_quotes(id,rider_id,expires_at,estimated_fare,data) VALUES($1,$2,$3,$4,$5)', [quote.quoteId, quote.riderId, quote.expiresAt, quote.fare.amount, quote]); }
  async consumeQuote(id: string, tripId: string): Promise<void> {
    const [rows]: [{ id: string }[], number] = await this.db.query(`UPDATE trip_quotes SET consumed_trip_id=$2::uuid,data=jsonb_set(data,'{consumedTripId}',to_jsonb($2::text)) WHERE id=$1 AND consumed_trip_id IS NULL RETURNING id`, [id, tripId]);
    if (!rows.length) throw new DomainError('QUOTE_ALREADY_USED');
  }
  async active(principal: Principal): Promise<TripData | null> {
    const field = principal.role === 'RIDER' ? 'rider_id' : 'driver_id';
    const rows: DataRow<TripData>[] = await this.db.query(`SELECT data FROM trips WHERE ${field}=$1 AND status IN ('CREATED','SEARCHING','ASSIGNED','DRIVER_ARRIVED','IN_PROGRESS')`, [principal.sub]);
    return rows[0]?.data ?? null;
  }
  async list(principal: Principal, limit: number, status?: string, cursor?: PageKey): Promise<TripData[]> {
    const field = principal.role === 'RIDER' ? 'rider_id' : 'driver_id';
    const rows: DataRow<TripData>[] = await this.db.query(`SELECT data FROM trips WHERE ${field}=$1 AND status IN ('COMPLETED','CANCELLED') AND ($2::text IS NULL OR status=$2) AND ($3::timestamptz IS NULL OR (requested_at,id)<($3::timestamptz,$4::uuid)) ORDER BY requested_at DESC,id DESC LIMIT $5`, [principal.sub, status ?? null, cursor?.requestedAt ?? null, cursor?.tripId ?? null, limit]);
    return rows.map(row => row.data);
  }
  async history(id: string): Promise<HistoryEntry[]> { const rows: DataRow<HistoryEntry>[] = await this.db.query('SELECT data FROM trip_status_history WHERE trip_id=$1 ORDER BY version', [id]); return rows.map(r => r.data); }
  async addHistory(id: string, entries: HistoryEntry[]): Promise<void> { for (const entry of entries) await this.db.query('INSERT INTO trip_status_history(trip_id,version,data) VALUES($1,$2,$3)', [id, entry.version, entry]); }
  private async lock(scope: string): Promise<void> { await this.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [scope]); }
  async lockReceipt(scope: string): Promise<void> { await this.lock(`receipt:${scope}`); }
  async receipt<T>(scope: string): Promise<Receipt<T> | null> { const rows: Receipt<T>[] = await this.db.query('SELECT hash,result FROM request_receipts WHERE scope=$1', [scope]); return rows[0] ?? null; }
  async saveReceipt<T>(scope: string, hash: string, result: T): Promise<void> { await this.db.query('INSERT INTO request_receipts(scope,hash,result) VALUES($1,$2,$3)', [scope, hash, result]); }
  async lockInbox(id: string): Promise<void> { await this.lock(`inbox:matching:${id}`); }
  async inbox<T>(id: string): Promise<Receipt<T> | null> { const rows: Receipt<T>[] = await this.db.query('SELECT hash,result FROM inbox_messages WHERE id=$1', [id]); return rows[0] ?? null; }
  async saveInbox<T>(id: string, hash: string, result: T): Promise<void> { await this.db.query('INSERT INTO inbox_messages(id,hash,result) VALUES($1,$2,$3)', [id, hash, result]); }
  async enqueue(message: OutboxMessage, destinations: Destination[]): Promise<void> {
    await this.db.query('INSERT INTO outbox(id,trip_id,trip_version,kind,payload) VALUES($1,$2,$3,$4,$5)', [message.id, message.tripId, message.tripVersion, message.kind, message.payload]);
    for (const destination of destinations) await this.db.query('INSERT INTO outbox_deliveries(outbox_id,destination) VALUES($1,$2)', [message.id, destination]);
  }
}
export class PgStore implements Store {
  constructor(public readonly db: DataSource) {}
  async ready(): Promise<boolean> {
    try { if (!this.db.isInitialized || await this.db.showMigrations()) return false; await this.db.query('SELECT 1 FROM trips LIMIT 1'); return true; } catch { return false; }
  }
  async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.db.transaction('READ COMMITTED', async manager => { await manager.query("SET LOCAL lock_timeout='5s'"); return work(new PgTransaction(manager)); }); }
      catch (error) {
        if (error instanceof DomainError) throw error;
        const pg = error as { code?: string; constraint?: string };
        if (['40001', '40P01'].includes(pg.code ?? '') && attempt < 2) { await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1))); continue; }
        if (pg.code === '23505') {
          const code = pg.constraint === 'uq_trips_active_rider' ? 'ACTIVE_TRIP_EXISTS' : pg.constraint === 'uq_trips_active_driver' ? 'DRIVER_HAS_ACTIVE_TRIP' : pg.constraint === 'trips_quote_id_key' ? 'QUOTE_ALREADY_USED' : 'IDEMPOTENCY_KEY_REUSED';
          throw new DomainError(code);
        }
        if (pg.code === '55P03') throw new DomainError('REQUEST_IN_PROGRESS');
        if (['40001', '40P01', 'ECONNREFUSED', '57P01', '53300'].includes(pg.code ?? '')) throw new DomainError('DEPENDENCY_UNAVAILABLE');
        throw error;
      }
    }
  }
}
