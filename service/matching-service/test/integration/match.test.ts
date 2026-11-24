import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { source, Repository } from '../../src/infrastructure/persistence';
import { Commands } from '../../src/application/commands';
import { MatchDriver } from '../../src/application/match';
import { OfferExpiry } from '../../src/application/expiry';
import { DirectCandidates } from '../../src/application/candidates';
import type { CandidateClients } from '../../src/application/ports';
import { listed, type ListedClients } from './listed-source';
import type { Command } from '../../src/domain/models';
export const command = (): Command => ({ commandId: randomUUID(), tripId: randomUUID(), type: 'matching.search.requested', tripVersion: 2, occurredAt: new Date().toISOString(), riderId: randomUUID(), pickup: { lat: 21.0285, lng: 105.8542 }, destination: { lat: 21.0272, lng: 105.8355 }, vehicleType: 'CAR_4', route: { distanceMeters: 2546, durationSeconds: 258 }, fare: { currency: 'VND', amount: '27460' } });
test('concurrent trips hold one driver; empty matrix stays SEARCHING; expired never offered twice', { skip: !process.env.MATCHING_TEST_DATABASE_URL }, async () => {
  const db = source(process.env.MATCHING_TEST_DATABASE_URL!); await db.initialize(); await db.runMigrations(); const repo = new Repository(db), commands = new Commands(repo), driverId = randomUUID();
  const clients: ListedClients = { matrix: async () => [{ driverId, observedAt: new Date().toISOString(), status: 'OK', durationSeconds: 10, distanceMeters: 100 }], driver: async () => ({ driverId, profileEligible: true, desiredStatus: 'ONLINE', vehicleId: randomUUID(), driverSnapshot: { fullName: 'Test', avatarUrl: null }, vehicleSnapshot: { vehicleType: 'CAR_4', licensePlate: 'TEST', brand: null, color: null } }), assign: async () => {}, trip: async id => ({ tripId: id, status: 'SEARCHING', driverId: null, version: 2 }) };
  const a = command(), b = command();
  try {
    await commands.search(a); await commands.search(b); const match = new MatchDriver(repo, listed(clients));
    await Promise.all([match.execute(a.tripId), match.execute(b.tripId)]);
    const held = await repo.reservations([driverId]); assert.ok(held[0]?.tripId);
    const winner = held[0]!.tripId!, loser = winner === a.tripId ? b.tripId : a.tripId;
    // A search holding a PENDING offer is not due again until just after the 20 s offer expires (no 1 s re-checks).
    const due: { wait: string }[] = await db.query('SELECT extract(epoch FROM due_at-clock_timestamp())*1000 AS wait FROM matching_searches WHERE trip_id=$1', [winner]); assert.ok(Number(due[0]!.wait) > 19000);
    assert.equal((await repo.getSearch(loser))?.status, 'SEARCHING'); assert.equal((await repo.getSearch(loser))?.offerId, null);
    await repo.transaction(async tx => { const s = (await tx.search(winner))!, o = (await tx.offer(s.offerId!))!; o.expiresAt = new Date(0).toISOString(); await tx.db.query('UPDATE matching_offers SET expires_at=$2,data=$3 WHERE id=$1', [o.offerId, o.expiresAt, o]); });
    await new OfferExpiry(repo).tick(); await match.execute(winner); assert.equal((await repo.getSearch(winner))?.offerId, null); assert.equal((await repo.getSearch(winner))?.status, 'SEARCHING');
    await commands.stop(randomUUID(), loser, {}, 'CANCELLED');
  } finally { await db.destroy(); }
});
test('direct search: offer uses the batch snapshot and skips drivers held by another trip', { skip: !process.env.MATCHING_TEST_DATABASE_URL }, async () => {
  const db = source(process.env.MATCHING_TEST_DATABASE_URL!); await db.initialize(); await db.runMigrations(); const repo = new Repository(db), commands = new Commands(repo);
  const busy = randomUUID(), free = randomUUID(), vehicleId = randomUUID(); let asked: string[][] = [];
  const located = (driverId: string, distanceMeters: number) => ({ driverId, latitude: 21.0285, longitude: 105.8542, distanceMeters, recordedAt: new Date().toISOString() });
  const direct: CandidateClients = {
    locations: async () => ({ drivers: [located(busy, 10), located(free, 20)], nextOffset: null }),
    candidates: async ids => { asked.push(ids); return ids.map(driverId => ({ driverId, eligible: true, reasons: [], vehicleId, driverSnapshot: { fullName: 'Batch', avatarUrl: null }, vehicleSnapshot: { vehicleType: 'CAR_4', licensePlate: 'BATCH', brand: null, color: null } })); },
    eta: async (_d, _t, origins) => origins.map(o => ({ id: o.id, status: 'OK' as const, distanceMeters: 100, durationSeconds: o.id === busy ? 10 : 20 })),
  };
  const first = command(), second = command();
  try {
    await commands.search(first); await commands.search(second);
    const match = new MatchDriver(repo, new DirectCandidates(direct, { nearbyLimit: 200, nearbyPages: 5, matrixCandidates: 25 }));
    await match.execute(first.tripId);
    const held = (await repo.reservations([busy, free])).find(r => r.tripId === first.tripId)!;
    assert.equal(held.driverId, busy); // shortest ETA
    const offer = (await repo.activeOffer(busy))!;
    assert.equal(offer.assignment.vehicleId, vehicleId); assert.equal(offer.assignment.driverSnapshot.fullName, 'Batch');
    asked = [];
    await match.execute(second.tripId);
    assert.deepEqual(asked, [[free]]); // the reserved driver is dropped before Driver is asked
    assert.equal((await repo.activeOffer(free))?.tripId, second.tripId);
    for (const c of [first, second]) await commands.stop(randomUUID(), c.tripId, {}, 'CANCELLED');
  } finally { await db.destroy(); }
});
