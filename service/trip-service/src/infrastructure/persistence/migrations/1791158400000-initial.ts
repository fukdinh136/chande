import type { MigrationInterface, QueryRunner } from 'typeorm';
export class InitialTripSchema1791158400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE trip_quotes (
        id uuid PRIMARY KEY, rider_id uuid NOT NULL, expires_at timestamptz NOT NULL,
        estimated_fare bigint NOT NULL CHECK (estimated_fare >= 0), consumed_trip_id uuid UNIQUE, data jsonb NOT NULL
      );
      CREATE TABLE trips (
        id uuid PRIMARY KEY, quote_id uuid NOT NULL UNIQUE REFERENCES trip_quotes(id), rider_id uuid NOT NULL,
        driver_id uuid, vehicle_id uuid, status varchar(20) NOT NULL,
        version integer NOT NULL CHECK (version >= 0), requested_at timestamptz NOT NULL,
        estimated_fare bigint NOT NULL CHECK (estimated_fare >= 0), final_fare bigint, data jsonb NOT NULL,
        CONSTRAINT valid_trip_status CHECK (status IN ('CREATED','SEARCHING','ASSIGNED','DRIVER_ARRIVED','IN_PROGRESS','COMPLETED','CANCELLED')),
        CONSTRAINT valid_trip_fare CHECK ((status = 'COMPLETED' AND final_fare = estimated_fare) OR (status <> 'COMPLETED' AND final_fare IS NULL)),
        CONSTRAINT valid_assignment CHECK ((status IN ('ASSIGNED','DRIVER_ARRIVED','IN_PROGRESS','COMPLETED') AND driver_id IS NOT NULL AND vehicle_id IS NOT NULL) OR status IN ('CREATED','SEARCHING','CANCELLED'))
      );
      ALTER TABLE trip_quotes ADD CONSTRAINT quote_consumed_trip_fk FOREIGN KEY (consumed_trip_id) REFERENCES trips(id);
      CREATE UNIQUE INDEX uq_trips_active_rider ON trips(rider_id) WHERE status IN ('CREATED','SEARCHING','ASSIGNED','DRIVER_ARRIVED','IN_PROGRESS');
      CREATE UNIQUE INDEX uq_trips_active_driver ON trips(driver_id) WHERE driver_id IS NOT NULL AND status IN ('CREATED','SEARCHING','ASSIGNED','DRIVER_ARRIVED','IN_PROGRESS');
      CREATE INDEX trips_rider_history ON trips(rider_id, requested_at DESC, id DESC);
      CREATE INDEX trips_driver_history ON trips(driver_id, requested_at DESC, id DESC);
      CREATE TABLE trip_status_history (
        id bigserial PRIMARY KEY, trip_id uuid NOT NULL REFERENCES trips(id), version integer NOT NULL,
        data jsonb NOT NULL, UNIQUE(trip_id,version)
      );
      CREATE TABLE request_receipts(scope text PRIMARY KEY, hash text NOT NULL, result jsonb NOT NULL);
      CREATE TABLE inbox_messages(id uuid PRIMARY KEY, source text NOT NULL DEFAULT 'matching', hash text NOT NULL, result jsonb NOT NULL);
      CREATE TABLE outbox(id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES trips(id), trip_version integer NOT NULL, kind text NOT NULL CHECK(kind IN ('search','cancel','event')), payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE outbox_deliveries(
        id bigserial PRIMARY KEY, outbox_id uuid NOT NULL REFERENCES outbox(id), destination text NOT NULL CHECK(destination IN ('matching','gateway','notification')),
        status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','delivered','blocked','skipped')),
        attempts integer NOT NULL DEFAULT 0, next_retry_at timestamptz NOT NULL DEFAULT now(), lease_owner uuid, lease_until timestamptz, last_error text,
        UNIQUE(outbox_id,destination)
      );
      CREATE INDEX outbox_pending ON outbox_deliveries(next_retry_at) WHERE status IN ('pending','processing');
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE trip_quotes DROP CONSTRAINT quote_consumed_trip_fk');
    await runner.query('DROP TABLE outbox_deliveries, outbox, inbox_messages, request_receipts, trip_status_history, trips, trip_quotes');
  }
}
