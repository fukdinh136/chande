import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { source, Repository } from '../../src/infrastructure/persistence';
import { Commands } from '../../src/application/commands';
import { MatchDriver } from '../../src/application/match';
import { OfferDecisions, AssignDriver } from '../../src/application/decisions';
import { createApi, context } from '../../src/api/app';
import type { Clients, TripState } from '../../src/application/ports';
import type { Config } from '../../src/bootstrap/config';
import type { Command } from '../../src/domain/models';
test('durable decisions: replay, competing decline, lost callback ACK and terminal race', { skip: !process.env.MATCHING_TEST_DATABASE_URL }, async () => {
  const db = source(process.env.MATCHING_TEST_DATABASE_URL!); await db.initialize(); await db.runMigrations(); const repo = new Repository(db), commands = new Commands(repo), driverId = randomUUID(), vehicleId = randomUUID();
  const cmd: Command = { commandId: randomUUID(), tripId: randomUUID(), type: 'matching.search.requested', tripVersion: 2, occurredAt: new Date().toISOString(), riderId: randomUUID(), pickup: { lat: 21.0285, lng: 105.8542 }, destination: { lat: 21.0272, lng: 105.8355 }, vehicleType: 'CAR_4', route: { distanceMeters: 2546, durationSeconds: 258 }, fare: { currency: 'VND', amount: '27460' } };
  let state: TripState = { tripId: cmd.tripId, status: 'SEARCHING', driverId: null, version: 2 }, calls = 0;
  const clients: Clients = { matrix: async () => [{ driverId, observedAt: new Date().toISOString(), status: 'OK', durationSeconds: 10, distanceMeters: 100 }], driver: async () => ({ driverId, profileEligible: true, desiredStatus: 'ONLINE', vehicleId, driverSnapshot: { fullName: 'Test', avatarUrl: null }, vehicleSnapshot: { vehicleType: 'CAR_4', licensePlate: 'TEST', brand: null, color: null } }), assign: async () => { calls++; state = { ...state, status: 'ASSIGNED', driverId }; throw new Error('lost ACK after commit'); }, trip: async () => state };
  try {
    await commands.search(cmd); await new MatchDriver(repo, clients).execute(cmd.tripId); const o = (await repo.activeOffer(driverId))!, decisions = new OfferDecisions(repo), key = randomUUID();
    await assert.rejects(decisions.execute(o.offerId, randomUUID(), key, 'accept'), /FORBIDDEN/);
    const accepted = await decisions.execute(o.offerId, driverId, key, 'accept');
    assert.deepEqual(await decisions.execute(o.offerId, driverId, key, 'accept'), accepted);
    await assert.rejects(decisions.execute(o.offerId, driverId, key, 'decline'), /IDEMPOTENCY_CONFLICT/);
    await assert.rejects(decisions.execute(o.offerId, driverId, randomUUID(), 'decline'), /OFFER_CLOSED/);
    await new AssignDriver(repo, clients).execute(cmd.tripId); assert.equal(calls, 1); assert.equal((await repo.getSearch(cmd.tripId))?.status, 'ASSIGNED');
    await commands.stop(randomUUID(), cmd.tripId, {}, 'CANCELLED'); assert.equal((await repo.reservations([driverId]))[0]?.tripId, null);
    await new AssignDriver(repo, clients).execute(cmd.tripId); assert.equal((await repo.getSearch(cmd.tripId))?.status, 'CANCELLED'); assert.equal(calls, 1);
    const c = { config: { tokens: { trip: 'trip', driver: 'driver', realtime: 'realtime' }, swagger: false } as Config, repo, commands, decisions, identity: { verify: async () => driverId } };
    const app = await createApi(c); await app.listen(0, '127.0.0.1');
    try { const root = await app.getUrl(); const r = await fetch(root + '/internal/matching/reservations/batch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Service-Token': 'trip' }, body: JSON.stringify({ driverIds: [driverId] }) }); assert.equal(r.status, 401); const got = await fetch(root + '/matching/offers/' + o.offerId); assert.equal(got.status, 200); assert.equal((await got.json()).data.status, 'REVOKED'); } finally { await app.close(); }
    assert.ok(context); // Exported factory remains usable by main.
  } finally { await db.destroy(); }
});
