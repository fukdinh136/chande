import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { source, Repository } from '../../src/infrastructure/persistence';
import { Commands } from '../../src/application/commands';
import { MatchDriver } from '../../src/application/match';
import type { Clients } from '../../src/application/ports';
import type { Command } from '../../src/domain/models';
export const command = (): Command => ({ commandId: randomUUID(), tripId: randomUUID(), type: 'matching.search.requested', tripVersion: 2, occurredAt: new Date().toISOString(), riderId: randomUUID(), pickup: { lat: 21.0285, lng: 105.8542 }, destination: { lat: 21.0272, lng: 105.8355 }, vehicleType: 'CAR_4', route: { distanceMeters: 2546, durationSeconds: 258 }, fare: { currency: 'VND', amount: '27460' } });
test('concurrent trips hold one driver; empty matrix stays SEARCHING; expired never offered twice', { skip: !process.env.MATCHING_TEST_DATABASE_URL }, async () => {
  const db = source(process.env.MATCHING_TEST_DATABASE_URL!); await db.initialize(); await db.runMigrations(); const repo = new Repository(db), commands = new Commands(repo), driverId = randomUUID();
  const clients: Clients = { matrix: async () => [{ driverId, observedAt: new Date().toISOString(), status: 'OK', durationSeconds: 10, distanceMeters: 100 }], driver: async () => ({ driverId, profileEligible: true, desiredStatus: 'ONLINE', vehicleId: randomUUID(), driverSnapshot: { fullName: 'Test', avatarUrl: null }, vehicleSnapshot: { vehicleType: 'CAR_4', licensePlate: 'TEST', brand: null, color: null } }), assign: async () => {}, trip: async id => ({ tripId: id, status: 'SEARCHING', driverId: null, version: 2 }) };
  const a = command(), b = command();
  try {
    await commands.search(a); await commands.search(b); const match = new MatchDriver(repo, clients);
    await Promise.all([match.execute(a.tripId), match.execute(b.tripId)]);
    const held = await repo.reservations([driverId]); assert.ok(held[0]?.tripId);
    const winner = held[0]!.tripId!, loser = winner === a.tripId ? b.tripId : a.tripId;
    assert.equal((await repo.getSearch(loser))?.status, 'SEARCHING'); assert.equal((await repo.getSearch(loser))?.offerId, null);
    await repo.transaction(async tx => { const s = (await tx.search(winner))!, o = (await tx.offer(s.offerId!))!; o.expiresAt = new Date(0).toISOString(); await tx.db.query('UPDATE matching_offers SET expires_at=$2,data=$3 WHERE id=$1', [o.offerId, o.expiresAt, o]); });
    await match.execute(winner); await match.execute(winner); assert.equal((await repo.getSearch(winner))?.offerId, null); assert.equal((await repo.getSearch(winner))?.status, 'SEARCHING');
    await commands.stop(randomUUID(), loser, {}, 'CANCELLED');
  } finally { await db.destroy(); }
});
