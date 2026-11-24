import { rank, type Candidate } from '../../src/domain/models';
import type { CandidateSource, Clients } from '../../src/application/ports';
/** Test double: a fixed candidate list (as a matrix used to return) and eligibility asked per driver. */
export type ListedClients = Omit<Clients, 'noDriver'> & { matrix(): Promise<Candidate[]> };
export function listed(clients: ListedClients): CandidateSource {
  return {
    async find(command, exclude) {
      const list = await clients.matrix();
      const skip = await exclude(list.map(c => c.driverId));
      return rank(list, skip, new Set(), Date.now()).map(candidate => ({ candidate, eligibility: () => clients.driver(candidate.driverId, command.vehicleType) }));
    },
  };
}
