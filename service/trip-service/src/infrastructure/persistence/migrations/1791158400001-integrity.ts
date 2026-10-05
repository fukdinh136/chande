import type { MigrationInterface, QueryRunner } from 'typeorm';
export class TripIntegrity1791158400001 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE trips ADD CONSTRAINT completed_fare_required CHECK (status <> 'COMPLETED' OR final_fare IS NOT NULL);
      ALTER TABLE trips ADD CONSTRAINT trip_projection_consistent CHECK (data @> jsonb_build_object(
        'tripId',id,'quoteId',quote_id,'riderId',rider_id,'driverId',driver_id,'vehicleId',vehicle_id,'status',status,'version',version,
        'fare',jsonb_build_object('estimatedAmount',estimated_fare::text,'finalAmount',final_fare::text)));
      ALTER TABLE trip_quotes ADD CONSTRAINT quote_projection_consistent CHECK (data @> jsonb_build_object(
        'quoteId',id,'riderId',rider_id,'consumedTripId',consumed_trip_id,'fare',jsonb_build_object('amount',estimated_fare::text)));
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE trips DROP CONSTRAINT completed_fare_required, DROP CONSTRAINT trip_projection_consistent; ALTER TABLE trip_quotes DROP CONSTRAINT quote_projection_consistent');
  }
}
