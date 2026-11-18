import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DirectCandidates } from '../src/application/candidates';
import type { CandidateClients, CandidateEligibility } from '../src/application/ports';
import type { Command } from '../src/domain/models';
const command = (): Command => ({ commandId: randomUUID(), tripId: randomUUID(), type: 'matching.search.requested', tripVersion: 2, occurredAt: new Date().toISOString(), riderId: randomUUID(), pickup: { lat: 21.0285, lng: 105.8542, address: 'Hồ Gươm' }, destination: { lat: 21.0272, lng: 105.8355 }, vehicleType: 'CAR_4', route: { distanceMeters: 2546, durationSeconds: 258 }, fare: { currency: 'VND', amount: '27460' } });
const location = (i: number) => ({ driverId: randomUUID(), latitude: 21.0285 + i / 10000, longitude: 105.8542, distanceMeters: i * 11, recordedAt: new Date(Date.now() - 1000).toISOString() });
const ok = (driverId: string, type = 'CAR_4'): CandidateEligibility => ({ driverId, eligible: true, reasons: [], vehicleId: randomUUID(), driverSnapshot: { fullName: 'D', avatarUrl: null }, vehicleSnapshot: { vehicleType: type, licensePlate: '30A-1', brand: null, color: null } });
function fake(count: number, decide: (id: string, i: number) => CandidateEligibility = id => ok(id)) {
  const all = Array.from({ length: count }, (_, i) => location(i));
  const calls = { locations: [] as number[], offsets: [] as number[], candidates: [] as string[][], eta: [] as string[][] };
  const clients: CandidateClients = {
    locations: async (pickup, limit, offset) => { assert.deepEqual(pickup, { lat: 21.0285, lng: 105.8542 }); calls.locations.push(limit); calls.offsets.push(offset); return { drivers: all.slice(offset, offset + limit), nextOffset: offset + limit < all.length ? offset + limit : null }; },
    candidates: async (ids, type) => { assert.equal(type, 'CAR_4'); assert.ok(ids.length <= 100); calls.candidates.push(ids); return ids.map(id => decide(id, all.findIndex(l => l.driverId === id))); },
    // Farther drivers get a shorter ETA here, so ranking by ETA must reorder them.
    eta: async (destination, type, origins) => { assert.deepEqual(destination, { lat: 21.0285, lng: 105.8542 }); calls.eta.push(origins.map(o => o.id)); return origins.map((o, i) => ({ id: o.id, status: 'OK' as const, distanceMeters: 100, durationSeconds: 1000 - i })); },
  };
  return { all, calls, clients };
}
const none = async () => new Set<string>();
test('direct search: one call per service, ETA only for the 25 nearest eligible, ranked by ETA', async () => {
  const f = fake(200);
  const ranked = await new DirectCandidates(f.clients, { nearbyLimit: 200, nearbyPages: 5, matrixCandidates: 25 }).find(command(), none);
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
  const ranked = await new DirectCandidates(f.clients, { nearbyLimit: 200, nearbyPages: 5, matrixCandidates: 25 }).find(command(), async ids => { asked = ids; return skip; });
  assert.equal(asked.length, 10);
  assert.ok(f.calls.candidates[0]!.every(id => !skip.has(id)));
  assert.ok(ranked.every(r => !skip.has(r.candidate.driverId)));
  assert.equal(ranked.length, 8);
});
test('direct search: ineligible, wrong vehicle type and stale drivers are not offered; nobody eligible skips Routing', async () => {
  const f = fake(4, (id, i) => i === 0 ? { ...ok(id), eligible: false, reasons: ['DRIVER_OFFLINE'], driverSnapshot: null, vehicleSnapshot: null } : i === 1 ? ok(id, 'CAR_7') : ok(id));
  f.all[2]!.recordedAt = new Date(Date.now() - 31000).toISOString();
  const ranked = await new DirectCandidates(f.clients, { nearbyLimit: 200, nearbyPages: 5, matrixCandidates: 25 }).find(command(), none);
  assert.deepEqual(f.calls.eta[0], [f.all[2]!.driverId, f.all[3]!.driverId]);
  assert.deepEqual(ranked.map(r => r.candidate.driverId), [f.all[3]!.driverId]);
  const nobody = fake(3, id => ({ ...ok(id), eligible: false, reasons: ['DRIVER_OFFLINE'], vehicleSnapshot: null, driverSnapshot: null }));
  assert.deepEqual(await new DirectCandidates(nobody.clients, { nearbyLimit: 200, nearbyPages: 5, matrixCandidates: 25 }).find(command(), none), []);
  assert.equal(nobody.calls.eta.length, 0);
  const empty = fake(0);
  assert.deepEqual(await new DirectCandidates(empty.clients, { nearbyLimit: 200, nearbyPages: 5, matrixCandidates: 25 }).find(command(), none), []);
  assert.equal(empty.calls.candidates.length, 0);
});
test('direct search: when the nearest page is all busy, the next page is read and its free drivers offered', async () => {
  // C1, 2026-11-18: the 200 nearest drivers were all on trips while hundreds were free farther out in the radius.
  const f = fake(450);
  const busy = new Set<string>(f.all.slice(0, 200).map(l => l.driverId));
  const asked: string[][] = [];
  const ranked = await new DirectCandidates(f.clients, { nearbyLimit: 200, nearbyPages: 5, matrixCandidates: 25 }).find(command(), async ids => { asked.push(ids); return new Set(ids.filter(id => busy.has(id))); });
  assert.deepEqual(f.calls.offsets, [0, 200]);
  assert.deepEqual(asked.map(ids => ids.length), [200, 200]);
  // Driver and Routing only see the second page: the nearest 25 free drivers, ranks 200-224.
  assert.ok(f.calls.candidates.flat().every(id => !busy.has(id)));
  assert.deepEqual(f.calls.eta[0], f.all.slice(200, 225).map(l => l.driverId));
  assert.equal(ranked.length, 25);
});
test('direct search: a page with any eligible driver ends the search; ineligible pages also move on', async () => {
  const f = fake(450, (id, i) => i < 200 ? { ...ok(id), eligible: false, reasons: ['DRIVER_OFFLINE'], driverSnapshot: null, vehicleSnapshot: null } : ok(id));
  const ranked = await new DirectCandidates(f.clients, { nearbyLimit: 200, nearbyPages: 5, matrixCandidates: 25 }).find(command(), none);
  assert.deepEqual(f.calls.offsets, [0, 200]);
  assert.equal(ranked.length, 25);
  const first = fake(450);
  await new DirectCandidates(first.clients, { nearbyLimit: 200, nearbyPages: 5, matrixCandidates: 25 }).find(command(), none);
  assert.deepEqual(first.calls.offsets, [0]);
});
test('direct search: stops at nearbyPages or the end of the radius, and checks a driver seen on two pages once', async () => {
  const f = fake(2000);
  const everyone = async (ids: string[]) => new Set(ids);
  assert.deepEqual(await new DirectCandidates(f.clients, { nearbyLimit: 200, nearbyPages: 3, matrixCandidates: 25 }).find(command(), everyone), []);
  assert.deepEqual(f.calls.offsets, [0, 200, 400]);
  const g = fake(300);
  assert.deepEqual(await new DirectCandidates(g.clients, { nearbyLimit: 200, nearbyPages: 5, matrixCandidates: 25 }).find(command(), everyone), []);
  assert.deepEqual(g.calls.offsets, [0, 200]);
  // The driver at rank 199 moved and is ranked 200 on the next page: the second exclude call does not see it again.
  const h = fake(450);
  const moved = h.all[199]!;
  const clients = { ...h.clients, locations: async (pickup: { lat: number; lng: number }, limit: number, offset: number) => {
    const page = await h.clients.locations(pickup, limit, offset);
    return offset === 200 ? { ...page, drivers: [moved, ...page.drivers.slice(0, -1)] } : page;
  } };
  const asked: string[][] = [];
  await new DirectCandidates(clients, { nearbyLimit: 200, nearbyPages: 2, matrixCandidates: 25 }).find(command(), async ids => { asked.push(ids); return new Set(ids); });
  assert.equal(asked.length, 2);
  assert.ok(!asked[1]!.includes(moved.driverId));
  assert.equal(asked[1]!.length, 199);
});
