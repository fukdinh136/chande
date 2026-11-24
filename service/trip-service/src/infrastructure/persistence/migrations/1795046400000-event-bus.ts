import type { MigrationInterface, QueryRunner } from 'typeorm';
/** ADR-0002: trip events are delivered to the RabbitMQ exchange trip.events as one `bus` delivery. */
export class TripEventBus1795046400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE outbox_deliveries DROP CONSTRAINT IF EXISTS outbox_deliveries_destination_check');
    await runner.query("ALTER TABLE outbox_deliveries ADD CONSTRAINT outbox_deliveries_destination_check CHECK(destination IN ('matching','gateway','notification','bus'))");
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE outbox_deliveries DROP CONSTRAINT IF EXISTS outbox_deliveries_destination_check');
    await runner.query("ALTER TABLE outbox_deliveries ADD CONSTRAINT outbox_deliveries_destination_check CHECK(destination IN ('matching','gateway','notification'))");
  }
}
