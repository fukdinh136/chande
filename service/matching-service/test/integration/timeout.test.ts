import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { source, Repository } from '../../src/infrastructure/persistence';
import { Commands } from '../../src/application/commands';
import { MatchDriver } from '../../src/application/match';
import { OfferDecisions } from '../../src/application/decisions';
import { SearchTimeout } from '../../src/application/timeout';
import { UpstreamError } from '../../src/infrastructure/clients';
import type { Clients, TripState } from '../../src/application/ports';
import { listed, type ListedClients } from './listed-source';
import { command } from './match.test';

// ADR-0004: a search past its deadline with no offer pending cancels the trip as NO_DRIVER_FOUND, once.
test('search deadline cancels the trip once, keeps a pending offer, and retries with the same key', { skip: !process.env.MATCHING_TEST_DATABASE_URL }, async () => {
  const db = source(process.env.MATCHING_TEST_DATABASE_URL!); await db.initialize(); await db.runMigrations();
  const repo = new Repository(db), commands = new Commands(repo, 200), driverId = randomUUID(), vehicleId = randomUUID();
  const trips = new Map<string, TripState>(), keys: string[] = []; let failNext: 'network' | 'conflict' | null = null;
  const trip: Pick<Clients, 'noDriver' | 'trip'> = {
    async noDriver(tripId, eventId) {
      keys.push(eventId);
      if (failNext === 'network') { failNext = null; throw new UpstreamError(0, 'TIMEOUT', 'trip'); }
      if (failNext === 'conflict') { failNext = null; throw new UpstreamError(409, 'TRIP_NOT_SEARCHING', 'trip'); }
      const t = trips.get(tripId)!; if (t.status === 'SEARCHING') trips.set(tripId, { ...t, status: 'CANCELLED', version: t.version + 1 });
    },
    async trip(tripId) { return trips.get(tripId)!; },
  };
  let offered: string[] = [];
  const clients: ListedClients = {
    matrix: async () => offered.map(id => ({ driverId: id, observedAt: new Date().toISOString(), status: 'OK' as const, durationSeconds: 10, distanceMeters: 100 })),
    driver: async id => ({ driverId: id, profileEligible: true, desiredStatus: 'ONLINE', vehicleId, driverSnapshot: { fullName: 'Test', avatarUrl: null }, vehicleSnapshot: { vehicleType: 'CAR_4', licensePlate: 'TEST', brand: null, color: null } }),
    assign: async () => {}, trip: async id => trips.get(id)!,
  };
  const match = new MatchDriver(repo, listed(clients), 5000, () => {}, new SearchTimeout(repo, trip));
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  try {
    // 1. No driver at all: the first search waits until the deadline, not a whole 5 s poll.
    const lonely = command(); trips.set(lonely.tripId, { tripId: lonely.tripId, status: 'SEARCHING', driverId: null, version: 2 });
    await commands.search(lonely); await match.execute(lonely.tripId);
    const due: { wait: string }[] = await db.query('SELECT extract(epoch FROM due_at-clock_timestamp())*1000 AS wait FROM matching_searches WHERE trip_id=$1', [lonely.tripId]);
    assert.ok(Number(due[0]!.wait) <= 200, 'due at the deadline');
    await wait(250);
    // A lost reply is retried with the same idempotency key.
    failNext = 'network'; await assert.rejects(match.execute(lonely.tripId)); assert.equal((await repo.getSearch(lonely.tripId))?.status, 'SEARCHING');
    await match.execute(lonely.tripId);
    assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
    assert.equal((await repo.getSearch(lonely.tripId))?.status, 'CANCELLED'); assert.equal(trips.get(lonely.tripId)?.status, 'CANCELLED');
    await match.execute(lonely.tripId); assert.equal(keys.length, 2, 'a closed search sends nothing more');

    // 2. An offer pending at the deadline runs out its 20 s, and an accept in that window still wins.
    offered = [driverId];
    const late = command(); trips.set(late.tripId, { tripId: late.tripId, status: 'SEARCHING', driverId: null, version: 2 });
    await commands.search(late); await match.execute(late.tripId);
    const offer = (await repo.activeOffer(driverId))!; assert.equal(offer.tripId, late.tripId);
    await wait(250); await match.execute(late.tripId);
    assert.equal((await repo.getSearch(late.tripId))?.status, 'SEARCHING'); assert.equal(keys.length, 2, 'no cancel while the offer is pending');
    await new OfferDecisions(repo).execute(offer.offerId, driverId, randomUUID(), 'accept');
    assert.equal((await repo.getSearch(late.tripId))?.status, 'ASSIGNMENT_PENDING');
    await commands.stop(randomUUID(), late.tripId, {}, 'CANCELLED');

    // 3. The rider cancelled first: Trip answers 409, the search closes from Trip's state.
    offered = [];
    const raced = command(); trips.set(raced.tripId, { tripId: raced.tripId, status: 'CANCELLED', driverId: null, version: 3 });
    await commands.search(raced); await wait(250); failNext = 'conflict'; await match.execute(raced.tripId);
    assert.equal((await repo.getSearch(raced.tripId))?.status, 'CANCELLED');

    // 4. No new offer after the deadline, even when a driver appears.
    const gone = command(); trips.set(gone.tripId, { tripId: gone.tripId, status: 'SEARCHING', driverId: null, version: 2 });
    await commands.search(gone); await wait(250); offered = [randomUUID()]; await match.execute(gone.tripId);
    assert.equal((await repo.getSearch(gone.tripId))?.status, 'CANCELLED'); assert.equal((await repo.tried(gone.tripId)).size, 0);

    // 5. A search stored before ADR-0004 has no deadlineAt: it times out from its booking time instead of hanging forever.
    offered = [];
    const legacy = { ...command(), occurredAt: new Date(Date.now() - 200000).toISOString() }; trips.set(legacy.tripId, { tripId: legacy.tripId, status: 'SEARCHING', driverId: null, version: 2 });
    await repo.transaction(tx => tx.saveSearch({ tripId: legacy.tripId, status: 'SEARCHING', command: legacy, offerId: null, attempts: 0 }));
    await new MatchDriver(repo, listed(clients), 5000, () => {}, new SearchTimeout(repo, trip, 180000)).execute(legacy.tripId);
    assert.equal((await repo.getSearch(legacy.tripId))?.status, 'CANCELLED'); assert.equal(trips.get(legacy.tripId)?.status, 'CANCELLED');
  } finally { await db.destroy(); }
});
