import type { MigrationInterface, QueryRunner } from 'typeorm';
// The outbox purge deletes the oldest fully delivered messages first; this index keeps it from scanning the table.
export class TripOutboxRetention1793750400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> { await runner.query('CREATE INDEX IF NOT EXISTS outbox_created ON outbox(created_at)'); }
  async down(runner: QueryRunner): Promise<void> { await runner.query('DROP INDEX IF EXISTS outbox_created'); }
}
