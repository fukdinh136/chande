import type { Candidate, Command } from '../domain/models';
import { rank } from '../domain/models';
import type { CandidateClients, CandidateEligibility, CandidateSource, DriverLocation, Ranked } from './ports';
import { countDrivers, countSearch, timed } from './metrics';
const BATCH = 100; // Driver's batch limit
// ADR-0001: Matching runs the search itself. Realtime gives the nearest raw locations a page at a time,
// Matching drops drivers it already offered or reserved, Driver checks the rest in batches, and Routing measures
// ETA for the `matrixCandidates` nearest eligible drivers only. When a whole page is busy or ineligible the search
// reads the next page, up to `nearbyPages`: in a crowded area the nearest 200 can all be on trips while free
// drivers sit just past them inside the radius (load test C1, 2026-11-18: 800-980 free drivers within 2 km,
// the first at rank 553-1399, and the trip never got an offer).
export class DirectCandidates implements CandidateSource {
  constructor(private readonly clients: CandidateClients, private readonly limits: { nearbyLimit: number; nearbyPages: number; matrixCandidates: number }) {}
  async find(command: Command, exclude: (ids: string[]) => Promise<Set<string>>): Promise<Ranked[]> {
    const pickup = { lat: command.pickup.lat, lng: command.pickup.lng };
    const seen = new Set<string>();
    let offset: number | null = 0, pages = 0, empty: 'no_nearby' | 'no_open' | 'no_eligible' = 'no_nearby';
    let eligible = new Map<string, CandidateEligibility>(), nearest: DriverLocation[] = [];
    while (offset !== null && pages < this.limits.nearbyPages && !nearest.length) {
      const from: number = offset;
      const page = await timed('locations', () => this.clients.locations(pickup, this.limits.nearbyLimit, from));
      pages++; offset = page.nextOffset;
      // A driver who moved between two calls can show up on both pages; check each driver once per search.
      const fresh = page.drivers.filter(l => !seen.has(l.driverId));
      fresh.forEach(l => seen.add(l.driverId));
      countDrivers('nearby', fresh.length);
      if (!fresh.length) continue;
      const skip = await timed('exclude', () => exclude(fresh.map(l => l.driverId)));
      const open = fresh.filter(l => !skip.has(l.driverId));
      countDrivers('open', open.length);
      if (!open.length) { empty = 'no_open'; continue; }
      const batches: string[][] = [];
      for (let i = 0; i < open.length; i += BATCH) batches.push(open.slice(i, i + BATCH).map(l => l.driverId));
      const checked = (await timed('eligibility', () => Promise.all(batches.map(ids => this.clients.candidates(ids, command.vehicleType))))).flat();
      eligible = new Map(checked.filter(c => c.eligible && c.vehicleId && c.driverSnapshot && c.vehicleSnapshot?.vehicleType === command.vehicleType).map(c => [c.driverId, c]));
      // Locations are closest first, so this keeps the nearest eligible drivers by straight-line distance.
      nearest = open.filter(l => eligible.has(l.driverId)).slice(0, this.limits.matrixCandidates);
      countDrivers('eligible', eligible.size);
      if (!nearest.length) empty = 'no_eligible';
    }
    if (!nearest.length) { countSearch(empty, pages); return []; }
    const cells = new Map((await timed('eta', () => this.clients.eta(pickup, command.vehicleType, nearest.map(l => ({ id: l.driverId, lat: l.latitude, lng: l.longitude }))))).map(c => [c.id, c]));
    const candidates: Candidate[] = nearest.map(l => {
      const cell = cells.get(l.driverId);
      return { driverId: l.driverId, observedAt: l.recordedAt, status: cell?.status ?? 'NO_ROUTE', distanceMeters: cell?.distanceMeters ?? null, durationSeconds: cell?.durationSeconds ?? null };
    });
    const ranked = rank(candidates, new Set(), new Set(), Date.now());
    countDrivers('ranked', ranked.length); countSearch(ranked.length ? 'found' : 'no_route', pages);
    return ranked.map(candidate => {
      const answer = eligible.get(candidate.driverId)!;
      return { candidate, eligibility: async () => asEligibility(answer) };
    });
  }
}
// Eligible in the batch means the profile passed and the driver is ONLINE with that vehicle.
function asEligibility(c: CandidateEligibility) {
  return { driverId: c.driverId, profileEligible: c.eligible, desiredStatus: 'ONLINE', vehicleId: c.vehicleId, driverSnapshot: c.driverSnapshot, vehicleSnapshot: c.vehicleSnapshot };
}
