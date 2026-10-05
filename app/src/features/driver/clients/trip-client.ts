import * as decode from '../contracts/decode';
import { isTerminal, type Trip, type TripCommand, type TripDetail } from '../contracts/models';
import type { HttpConfig } from '../http/config';
import { route } from '../http/routes';
import { ApiError } from '../http/errors';
import type { SessionManager } from '../session/session-manager';

export class TripClient {
  private seen = new Map<string, Trip>();
  private details = new Map<string, TripDetail>();
  constructor(private readonly session: SessionManager, private readonly config: HttpConfig) {}
  get enabled() { return this.config.tripBase !== null; }
  clear() { this.seen.clear(); this.details.clear(); }
  private remember(value: Trip) {
    if (value.driverId !== this.session.getSnapshot().session?.driver.driverId) throw new ApiError('FORBIDDEN', 403);
    const previous = this.seen.get(value.tripId);
    if (previous && previous.version >= value.version) return previous;
    this.seen.set(value.tripId, value);
    return value;
  }
  async active(signal?: AbortSignal) {
    const data = decode.activeTrip((await this.session.request({ ...route(this.config, 'activeTrip'), method: 'GET', signal })).data);
    const latest = data ? this.remember(data) : null;
    return latest && !isTerminal(latest) ? latest : null;
  }
  async detail(id: string, signal?: AbortSignal) {
    const data = decode.tripDetail((await this.session.request({ ...route(this.config, 'detail', id), method: 'GET', signal })).data);
    if (data.trip.tripId !== id.toLowerCase()) throw new ApiError('INVALID_RESPONSE');
    const previous = this.details.get(id);
    const latest = { trip: this.remember(data.trip), statusHistory: previous && previous.trip.version > data.trip.version ? previous.statusHistory : data.statusHistory };
    this.details.set(id, latest);
    return latest;
  }
  async history(cursor?: string, signal?: AbortSignal) {
    const data = decode.tripPage((await this.session.request({ ...route(this.config, 'history'), method: 'GET', query: { limit: '20', ...(cursor ? { cursor } : {}) }, signal })).data);
    return { ...data, items: data.items.map((item) => this.remember(item)) };
  }
  async execute(command: TripCommand) {
    const response = await this.session.request({
      ...route(this.config, command.kind === 'status' ? 'status' : 'cancel', command.tripId),
      method: command.kind === 'status' ? 'PATCH' : 'POST', body: command.body, key: command.key,
    });
    const data = decode.trip(response.data);
    if (data.tripId !== command.tripId) throw new ApiError('INVALID_RESPONSE');
    return { trip: this.remember(data), replayed: response.replayed };
  }
}
