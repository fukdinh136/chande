import type { Candidate, Command } from '../domain/models';
import { rank } from '../domain/models';
import type { CandidateClients, CandidateEligibility, CandidateSource, Ranked } from './ports';
import { countDrivers, countSearch, timed } from './metrics';
const BATCH = 100; // Driver's batch limit
// ADR-0001: Matching runs the search and calls each service once. Realtime gives the nearest raw
// locations, Matching drops drivers it already offered or reserved, Driver checks the rest in batches,
// and Routing measures ETA for the `matrixCandidates` nearest eligible drivers only.
export class DirectCandidates implements CandidateSource {
  constructor(private readonly clients: CandidateClients, private readonly limits: { nearbyLimit: number; matrixCandidates: number }) {}
  async find(command: Command, exclude: (ids: string[]) => Promise<Set<string>>): Promise<Ranked[]> {
    const pickup = { lat: command.pickup.lat, lng: command.pickup.lng };
    const locations = await timed('locations', () => this.clients.locations(pickup, this.limits.nearbyLimit));
    countDrivers('nearby', locations.length);
    if (!locations.length) { countSearch('no_nearby'); return []; }
    const skip = await timed('exclude', () => exclude(locations.map(l => l.driverId)));
    const open = locations.filter(l => !skip.has(l.driverId));
    countDrivers('open', open.length);
    if (!open.length) { countSearch('no_open'); return []; }
    const batches: string[][] = [];
    for (let i = 0; i < open.length; i += BATCH) batches.push(open.slice(i, i + BATCH).map(l => l.driverId));
    const checked = (await timed('eligibility', () => Promise.all(batches.map(ids => this.clients.candidates(ids, command.vehicleType))))).flat();
    const eligible = new Map(checked.filter(c => c.eligible && c.vehicleId && c.driverSnapshot && c.vehicleSnapshot?.vehicleType === command.vehicleType).map(c => [c.driverId, c]));
    // Locations are closest first, so this keeps the nearest eligible drivers by straight-line distance.
    const nearest = open.filter(l => eligible.has(l.driverId)).slice(0, this.limits.matrixCandidates);
    countDrivers('eligible', eligible.size);
    if (!nearest.length) { countSearch('no_eligible'); return []; }
    const cells = new Map((await timed('eta', () => this.clients.eta(pickup, command.vehicleType, nearest.map(l => ({ id: l.driverId, lat: l.latitude, lng: l.longitude }))))).map(c => [c.id, c]));
    const candidates: Candidate[] = nearest.map(l => {
      const cell = cells.get(l.driverId);
      return { driverId: l.driverId, observedAt: l.recordedAt, status: cell?.status ?? 'NO_ROUTE', distanceMeters: cell?.distanceMeters ?? null, durationSeconds: cell?.durationSeconds ?? null };
    });
    const ranked = rank(candidates, new Set(), new Set(), Date.now());
    countDrivers('ranked', ranked.length); countSearch(ranked.length ? 'found' : 'no_route');
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
