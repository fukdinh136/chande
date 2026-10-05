import type { DataSource } from 'typeorm';
import type { Destination } from '../../application/ports/store';
export interface Delivery { id: string; destination: Destination; attempts: number; kind: 'search' | 'cancel' | 'event'; payload: Record<string, unknown>; tripId: string }
export class PgOutbox {
  constructor(private readonly db: DataSource) {}
  async claim(owner: string, limit: number, leaseMs: number): Promise<Delivery[]> {
    return this.db.transaction(manager => manager.query(`
      WITH picked AS (
        SELECT id FROM outbox_deliveries
        WHERE (status='pending' AND next_retry_at<=now()) OR (status='processing' AND lease_until<=now())
        ORDER BY next_retry_at,id FOR UPDATE SKIP LOCKED LIMIT $1
      ), claimed AS (
        UPDATE outbox_deliveries d SET status='processing',attempts=d.attempts+1,lease_owner=$2::uuid,lease_until=now()+$3*interval '1 millisecond'
        FROM picked p WHERE d.id=p.id RETURNING d.*
      ) SELECT c.id::text,c.destination,c.attempts,o.kind,o.payload,o.trip_id AS "tripId" FROM claimed c JOIN outbox o ON o.id=c.outbox_id
    `, [limit, owner, leaseMs]));
  }
  async renew(owner: string, leaseMs: number): Promise<void> {
    await this.db.query("UPDATE outbox_deliveries SET lease_until=now()+$2*interval '1 millisecond' WHERE lease_owner=$1::uuid AND status='processing' AND lease_until>now()", [owner, leaseMs]);
  }
  async owns(id: string, owner: string): Promise<boolean> {
    const rows: { id: string }[] = await this.db.query("SELECT id FROM outbox_deliveries WHERE id=$1 AND lease_owner=$2::uuid AND status='processing' AND lease_until>now()", [id, owner]); return rows.length > 0;
  }
  async searching(id: string): Promise<boolean> { const rows: { status: string }[] = await this.db.query('SELECT status FROM trips WHERE id=$1', [id]); return rows[0]?.status === 'SEARCHING'; }
  async finish(id: string, owner: string, status: 'pending' | 'delivered' | 'blocked' | 'skipped', error: string | null = null, retryMs = 0): Promise<boolean> {
    const [, count]: [unknown[], number] = await this.db.query("UPDATE outbox_deliveries SET status=$3,last_error=$4,next_retry_at=now()+$5*interval '1 millisecond',lease_owner=NULL,lease_until=NULL WHERE id=$1 AND lease_owner=$2::uuid AND status='processing' AND lease_until>now()", [id, owner, status, error, retryMs]); return count === 1;
  }
  async requeue(id: string): Promise<boolean> {
    const [, count]: [unknown[], number] = await this.db.query("UPDATE outbox_deliveries SET status='pending',next_retry_at=now(),last_error=NULL WHERE id=$1 AND status='blocked'", [id]); return count === 1;
  }
}
