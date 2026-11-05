import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DirectCandidates, RoutingCandidates } from '../src/application/candidates';
import type { CandidateClients, CandidateEligibility, Clients } from '../src/application/ports';
import type { Command } from '../src/domain/models';
const command = (): Command => ({ commandId: randomUUID(), tripId: randomUUID(), type: 'matching.search.requested', tripVersion: 2, occurredAt: new Date().toISOString(), riderId: randomUUID(), pickup: { lat: 21.0285, lng: 105.8542, address: 'Hồ Gươm' }, destination: { lat: 21.0272, lng: 105.8355 }, vehicleType: 'CAR_4', route: { distanceMeters: 2546, durationSeconds: 258 }, fare: { currency: 'VND', amount: '27460' } });
const location = (i: number) => ({ driverId: randomUUID(), latitude: 21.0285 + i / 10000, longitude: 105.8542, distanceMeters: i * 11, recordedAt: new Date(Date.now() - 1000).toISOString() });
const ok = (driverId: string, type = 'CAR_4'): CandidateEligibility => ({ driverId, eligible: true, reasons: [], vehicleId: randomUUID(), driverSnapshot: { fullName: 'D', avatarUrl: null }, vehicleSnapshot: { vehicleType: type, licensePlate: '30A-1', brand: null, color: null } });
function fake(count: number, decide: (id: string, i: number) => CandidateEligibility = id => ok(id)) {
  const all = Array.from({ length: count }, (_, i) => location(i));
  const calls = { locations: [] as number[], candidates: [] as string[][], eta: [] as string[][] };
  const clients: CandidateClients = {
    locations: async (pickup, limit) => { assert.deepEqual(pickup, { lat: 21.0285, lng: 105.8542 }); calls.locations.push(limit); return all.slice(0, limit); },
    candidates: async (ids, type) => { assert.equal(type, 'CAR_4'); assert.ok(ids.length <= 100); calls.candidates.push(ids); return ids.map(id => decide(id, all.findIndex(l => l.driverId === id))); },
    // Farther drivers get a shorter ETA here, so ranking by ETA must reorder them.
    eta: async (destination, type, origins) => { assert.deepEqual(destination, { lat: 21.0285, lng: 105.8542 }); calls.eta.push(origins.map(o => o.id)); return origins.map((o, i) => ({ id: o.id, status: 'OK' as const, distanceMeters: 100, durationSeconds: 1000 - i })); },
  };
  return { all, calls, clients };
}
const none = async () => new Set<string>();
test('direct search: one call per service, ETA only for the 25 nearest eligible, ranked by ETA', async () => {
  const f = fake(200);
  const ranked = await new DirectCandidates(f.clients, { nearbyLimit: 200, matrixCandidates: 25 }).find(command(), none);
  assert.deepEqual(f.calls.locations, [200]);
  assert.deepEqual(f.calls.candidates.map(b => b.length), [100, 100]);
  assert.equal(f.calls.eta.length, 1);
  assert.deepEqual(f.calls.eta[0], f.all.slice(0, 25).map(l => l.driverId));
  assert.equal(ranked.length, 25);
  assert.equal(ranked[0]!.candidate.driverId, f.all[24]!.driverId); // shortest ETA first
  const e = await ranked[0]!.eligibility();
  assert.equal(e.profileEligible, true); assert.equal(e.desiredStatus, 'ONLINE'); assert.equal(e.vehicleSnapshot?.vehicleType, 'CAR_4');
});
test('direct search: offered or reserved drivers are dropped before Driver is asked', async () => {
  const f = fake(10);
  const skip = new Set<string>([f.all[0]!.driverId, f.all[3]!.driverId]);
  let asked: string[] = [];
  const ranked = await new DirectCandidates(f.clients, { nearbyLimit: 200, matrixCandidates: 25 }).find(command(), async ids => { asked = ids; return skip; });
  assert.equal(asked.length, 10);
  assert.ok(f.calls.candidates[0]!.every(id => !skip.has(id)));
  assert.ok(ranked.every(r => !skip.has(r.candidate.driverId)));
  assert.equal(ranked.length, 8);
});
test('direct search: ineligible, wrong vehicle type and stale drivers are not offered; nobody eligible skips Routing', async () => {
  const f = fake(4, (id, i) => i === 0 ? { ...ok(id), eligible: false, reasons: ['DRIVER_OFFLINE'], driverSnapshot: null, vehicleSnapshot: null } : i === 1 ? ok(id, 'CAR_7') : ok(id));
  f.all[2]!.recordedAt = new Date(Date.now() - 31000).toISOString();
  const ranked = await new DirectCandidates(f.clients, { nearbyLimit: 200, matrixCandidates: 25 }).find(command(), none);
  assert.deepEqual(f.calls.eta[0], [f.all[2]!.driverId, f.all[3]!.driverId]);
  assert.deepEqual(ranked.map(r => r.candidate.driverId), [f.all[3]!.driverId]);
  const nobody = fake(3, id => ({ ...ok(id), eligible: false, reasons: ['DRIVER_OFFLINE'], vehicleSnapshot: null, driverSnapshot: null }));
  assert.deepEqual(await new DirectCandidates(nobody.clients, { nearbyLimit: 200, matrixCandidates: 25 }).find(command(), none), []);
  assert.equal(nobody.calls.eta.length, 0);
  const empty = fake(0);
  assert.deepEqual(await new DirectCandidates(empty.clients, { nearbyLimit: 200, matrixCandidates: 25 }).find(command(), none), []);
  assert.equal(empty.calls.candidates.length, 0);
});
test('routing search (rollback path): asks Driver per candidate only when its turn comes', async () => {
  const driverId = randomUUID(), reserved = randomUUID(); let driverCalls = 0;
  const clients = { matrix: async () => [driverId, reserved].map(id => ({ driverId: id, observedAt: new Date().toISOString(), status: 'OK' as const, durationSeconds: 10, distanceMeters: 100 })),
    driver: async (id: string) => { driverCalls++; return { driverId: id, profileEligible: true, desiredStatus: 'ONLINE', vehicleId: null, driverSnapshot: null, vehicleSnapshot: null }; } } as unknown as Clients;
  const ranked = await new RoutingCandidates(clients).find(command(), async () => new Set([reserved]));
  assert.deepEqual(ranked.map(r => r.candidate.driverId), [driverId]);
  assert.equal(driverCalls, 0); await ranked[0]!.eligibility(); assert.equal(driverCalls, 1);
});
