import type {PlaceInput} from '../backend/clients';
import {BackendError} from '../backend/http';
import type {CustomerRuntime} from './provider';
import {savedPlace, savedPlaces, type SavedPlace} from './places';
import {customerError} from './errors';

interface PlacesState {items: SavedPlace[]; loaded: boolean; loading: boolean; error: string | null; busy: boolean}
// One address collection per Customer owner, shared by account/editor/booking picker.
export class CustomerDataStore {
  private state: PlacesState = {items: [], loaded: false, loading: false, error: null, busy: false};
  private listeners = new Set<() => void>();
  private alive = false;
  private epoch: number;
  private revision = 0;
  private read: Promise<void> | null = null;
  private readControl: AbortController | null = null;
  private mutationControl: AbortController | null = null;
  constructor(private runtime: CustomerRuntime) {this.epoch = runtime.session.getOwnerEpoch();}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {this.listeners.add(fn); return () => {this.listeners.delete(fn);};};
  private valid() {return this.alive && this.epoch === this.runtime.session.getOwnerEpoch();}
  private publish(patch: Partial<PlacesState>) {if (this.valid()) {this.state = {...this.state, ...patch}; this.listeners.forEach(fn => fn());}}
  start() {this.alive = true; this.publish({loading: false, busy: false}); return () => {this.alive = false; this.revision++; this.readControl?.abort(); this.mutationControl?.abort(); this.read = null; this.mutationControl = null;};}
  load = (force = false) => this.readPlaces(force);
  private readPlaces(force: boolean, afterWrite = false): Promise<void> {
    if (!this.valid() || this.state.busy && !afterWrite || !force && this.state.loaded) return Promise.resolve();
    if (this.read) return this.read;
    const revision = ++this.revision, control = new AbortController(); this.readControl = control;
    this.publish({loading: true, error: null});
    const job = Promise.resolve().then(async () => {
      try {
        if (!this.valid() || revision !== this.revision || control.signal.aborted) return;
        const raw = await this.runtime.session.authorized(token => this.runtime.user.places(token, control.signal));
        if (this.valid() && revision === this.revision && !control.signal.aborted) this.publish({items: savedPlaces(raw), loaded: true, error: null});
      } catch (error) {if (this.valid() && revision === this.revision && !control.signal.aborted) this.publish({error: customerError(error)});}
      finally {if (this.read === job) this.read = null; if (this.valid() && revision === this.revision) this.publish({loading: false});}
    });
    this.read = job; return job;
  }
  save = (input: PlaceInput, placeId?: string) => this.mutate(async signal => {
    const value = await this.runtime.session.authorized(token => placeId ? this.runtime.user.updatePlace(token, placeId, input, signal) : this.runtime.user.createPlace(token, input, signal));
    const place = savedPlace(value);
    if (placeId && place.id !== placeId) throw new BackendError('INVALID_RESPONSE');
    return {place};
  });
  makeDefault = (placeId: string) => this.mutate(async signal => {
    const place = savedPlace(await this.runtime.session.authorized(token => this.runtime.user.defaultPlace(token, placeId, signal)));
    if (place.id !== placeId || !place.isDefault) throw new BackendError('INVALID_RESPONSE');
    return {place};
  });
  remove = (placeId: string) => this.mutate(async signal => {
    await this.runtime.session.authorized(token => this.runtime.user.deletePlace(token, placeId, signal));
    return {removed: placeId};
  });
  private async mutate(work: (signal: AbortSignal) => Promise<{place?: SavedPlace; removed?: string}>) {
    if (!this.valid() || this.state.busy) throw new BackendError('REQUEST_IN_PROGRESS');
    this.revision++; this.readControl?.abort(); this.read = null;
    const control = new AbortController(); this.mutationControl = control;
    this.publish({busy: true, loading: false, error: null});
    try {
      const result = await work(control.signal);
      if (!this.valid() || control.signal.aborted) throw new BackendError('CANCELLED');
      const place = result.place;
      const items = this.state.items.filter(item => item.id !== result.removed && item.id !== place?.id).map(item => place?.isDefault ? {...item, isDefault: false} : item);
      if (place) items.unshift(place);
      this.publish({items});
      // Acknowledged writes stay successful even if the canonical refresh fails.
      // GET resolves default promotion after delete and server ordering.
      await this.readPlaces(true, true);
      if (!this.valid()) throw new BackendError('CANCELLED');
      return place;
    } finally {if (this.mutationControl === control) {this.mutationControl = null; this.publish({busy: false});}}
  }
}
