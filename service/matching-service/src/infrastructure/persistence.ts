import { createHash, randomUUID } from 'node:crypto';
import { DataSource, type EntityManager, type MigrationInterface, type QueryRunner } from 'typeorm';
import { MatchingError, type Offer, type Search } from '../domain/models';
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => JSON.stringify(k) + ':' + canonical(x)).join(',') + '}';
  return JSON.stringify(v);
};
export const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
export class MatchingInitial1791244800000 implements MigrationInterface {
  async up(q: QueryRunner) { await q.query(`
    CREATE TABLE matching_searches(trip_id uuid PRIMARY KEY, status text NOT NULL CHECK(status IN ('SEARCHING','ASSIGNMENT_PENDING','ASSIGNED','CANCELLED','COMPLETED')), data jsonb NOT NULL, due_at timestamptz NOT NULL DEFAULT clock_timestamp(), lease_id uuid, lease_until timestamptz);
    CREATE INDEX matching_due ON matching_searches(due_at) WHERE status IN ('SEARCHING','ASSIGNMENT_PENDING');
    CREATE TABLE matching_offers(id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES matching_searches(trip_id), driver_id uuid NOT NULL, status text NOT NULL CHECK(status IN ('PENDING','ASSIGNMENT_PENDING','ASSIGNED','DECLINED','EXPIRED','REJECTED','REVOKED')), expires_at timestamptz NOT NULL, data jsonb NOT NULL, UNIQUE(trip_id,driver_id));
    CREATE UNIQUE INDEX matching_one_offer ON matching_offers(trip_id) WHERE status IN ('PENDING','ASSIGNMENT_PENDING','ASSIGNED');
    CREATE TABLE matching_reservations(driver_id uuid PRIMARY KEY, trip_id uuid NOT NULL UNIQUE REFERENCES matching_searches(trip_id), offer_id uuid NOT NULL UNIQUE REFERENCES matching_offers(id));
    CREATE TABLE matching_receipts(scope text PRIMARY KEY, hash text NOT NULL, result jsonb NOT NULL);
    CREATE TABLE matching_outbox(id uuid PRIMARY KEY, payload jsonb NOT NULL, attempts integer NOT NULL DEFAULT 0, due_at timestamptz NOT NULL DEFAULT clock_timestamp(), lease_id uuid, lease_until timestamptz, published_at timestamptz);
  `); }
  async down(q: QueryRunner) { await q.query('DROP TABLE matching_outbox,matching_receipts,matching_reservations,matching_offers,matching_searches'); }
}
export function source(url: string) { return new DataSource({ type: 'postgres', url, migrations: [MatchingInitial1791244800000], synchronize: false, logging: false, extra: { max: 10, connectionTimeoutMillis: 5000, query_timeout: 10000 } }); }
export class Tx {
  constructor(readonly db: EntityManager) {}
  async lock(scope: string) { await this.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [scope]); }
  async now(): Promise<number> { const rows: { now: Date }[] = await this.db.query('SELECT clock_timestamp() AS now'); return rows[0]!.now.getTime(); }
  async search(id: string): Promise<Search | null> { const rows: { data: Search }[] = await this.db.query('SELECT data FROM matching_searches WHERE trip_id=$1 FOR UPDATE', [id]); return rows[0]?.data ?? null; }
  async saveSearch(s: Search, delay = 0) { await this.db.query(`INSERT INTO matching_searches(trip_id,status,data,due_at) VALUES($1,$2,$3,clock_timestamp()+$4*interval '1 millisecond') ON CONFLICT(trip_id) DO UPDATE SET status=$2,data=$3,due_at=clock_timestamp()+$4*interval '1 millisecond'`, [s.tripId, s.status, s, delay]); }
  async offer(id: string): Promise<Offer | null> { const rows: { data: Offer }[] = await this.db.query('SELECT data FROM matching_offers WHERE id=$1 FOR UPDATE', [id]); return rows[0]?.data ?? null; }
  async saveOffer(o: Offer) { await this.db.query('INSERT INTO matching_offers(id,trip_id,driver_id,status,expires_at,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET status=$4,data=$6', [o.offerId, o.tripId, o.driverId, o.status, o.expiresAt, o]); }
  async reserve(o: Offer): Promise<boolean> { const rows: { driver_id: string }[] = await this.db.query('INSERT INTO matching_reservations(driver_id,trip_id,offer_id) VALUES($1,$2,$3) ON CONFLICT(driver_id) DO NOTHING RETURNING driver_id', [o.driverId, o.tripId, o.offerId]); return rows.length === 1; }
  async release(o: Offer) { await this.db.query('DELETE FROM matching_reservations WHERE driver_id=$1 AND offer_id=$2', [o.driverId, o.offerId]); }
  async enqueue(o: Offer) { const id = randomUUID(); await this.db.query('INSERT INTO matching_outbox(id,payload) VALUES($1,$2)', [id, { eventId: id, type: o.status === 'PENDING' ? 'DRIVER_TRIP_OFFER' : 'DRIVER_TRIP_OFFER_UPDATED', offerId: o.offerId, tripId: o.tripId, driverId: o.driverId, version: o.version, status: o.status, expiresAt: o.expiresAt }]); }
  async receipt<T>(scope: string, input: unknown, work: () => Promise<T>): Promise<T> {
    await this.lock('receipt:' + scope); const digest = hash(input);
    const rows: { hash: string; result: T }[] = await this.db.query('SELECT hash,result FROM matching_receipts WHERE scope=$1', [scope]);
    if (rows[0]) { if (rows[0].hash !== digest) throw new MatchingError('IDEMPOTENCY_CONFLICT'); return rows[0].result; }
    const result = await work(); await this.db.query('INSERT INTO matching_receipts(scope,hash,result) VALUES($1,$2,$3)', [scope, digest, result]); return result;
  }
}
export class Repository {
  constructor(readonly db: DataSource) {}
  transaction<T>(work: (tx: Tx) => Promise<T>) { return this.db.transaction(async db => { await db.query("SET LOCAL lock_timeout='5s'"); return work(new Tx(db)); }); }
  async getSearch(id: string): Promise<Search | null> { const rows: { data: Search }[] = await this.db.query('SELECT data FROM matching_searches WHERE trip_id=$1', [id]); return rows[0]?.data ?? null; }
  async getOffer(id: string): Promise<Offer | null> { const rows: { data: Offer }[] = await this.db.query('SELECT data FROM matching_offers WHERE id=$1', [id]); return rows[0]?.data ?? null; }
  async activeOffer(driver: string): Promise<Offer | null> { const rows: { data: Offer }[] = await this.db.query(`SELECT o.data FROM matching_offers o JOIN matching_reservations r ON r.offer_id=o.id WHERE r.driver_id=$1 AND (o.status<>'PENDING' OR o.expires_at>clock_timestamp())`, [driver]); return rows[0]?.data ?? null; }
  async reservations(ids: string[]): Promise<{ driverId: string; tripId: string | null }[]> { const rows: { driver_id: string; trip_id: string }[] = ids.length ? await this.db.query(`SELECT r.driver_id,r.trip_id FROM matching_reservations r JOIN matching_offers o ON o.id=r.offer_id WHERE r.driver_id=ANY($1::uuid[]) AND (o.status<>'PENDING' OR o.expires_at>clock_timestamp())`, [ids]) : []; return ids.map(driverId => ({ driverId, tripId: rows.find(r => r.driver_id === driverId)?.trip_id ?? null })); }
  async tried(tripId: string): Promise<Set<string>> { const rows: { driver_id: string }[] = await this.db.query('SELECT driver_id FROM matching_offers WHERE trip_id=$1', [tripId]); return new Set(rows.map(r => r.driver_id)); }
  async claim(limit: number, leaseMs: number): Promise<{ trip_id: string; lease_id: string }[]> {
    return this.db.transaction(db => db.query(`WITH due AS (SELECT trip_id FROM matching_searches WHERE status IN ('SEARCHING','ASSIGNMENT_PENDING') AND due_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY due_at LIMIT $1 FOR UPDATE SKIP LOCKED), claimed AS (UPDATE matching_searches s SET lease_id=$2,lease_until=clock_timestamp()+$3*interval '1 millisecond' FROM due WHERE s.trip_id=due.trip_id RETURNING s.trip_id,s.lease_id) SELECT * FROM claimed`, [limit, randomUUID(), leaseMs]));
  }
  async finishLease(id: string, lease: string, delay?: number) { await this.db.query(`UPDATE matching_searches SET lease_id=NULL,lease_until=NULL${delay === undefined ? '' : ",due_at=clock_timestamp()+$3*interval '1 millisecond'"} WHERE trip_id=$1 AND lease_id=$2`, delay === undefined ? [id, lease] : [id, lease, delay]); }
  async ready() { try { return this.db.isInitialized && !await this.db.showMigrations(); } catch { return false; } }
}
