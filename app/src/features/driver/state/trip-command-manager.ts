import { randomUUID } from 'expo-crypto';
import type { TripClient } from '../clients/trip-client';
import { nextStatus, type Trip, type TripCommand } from '../contracts/models';
import { ApiError } from '../http/errors';
import type { SessionManager } from '../session/session-manager';
import type { DriverStorage } from '../session/storage';

export interface CommandState {
  pending: TripCommand | null;
  restoring: boolean;
  busy: boolean;
  error: unknown;
  message: string | null;
}
export class TripCommandManager {
  private owner: string | null = null;
  private epoch = 0;
  private ownerEpoch = -1;
  private unsubscribe: () => void;
  private state: CommandState = { pending: null, restoring: false, busy: false, error: null, message: null };
  private listeners = new Set<() => void>();
  constructor(private readonly trip: TripClient, private readonly session: SessionManager, private readonly storage: DriverStorage) {
    this.unsubscribe = session.subscribe(() => {
      if (this.owner && (this.ownerEpoch !== session.getOwnerEpoch() || !session.getSnapshot().usable)) void this.initialize(null);
    });
  }
  private owns(epoch: number) { return epoch === this.epoch && this.ownerEpoch === this.session.getOwnerEpoch() && this.session.getSnapshot().usable; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(patch: Partial<CommandState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  async initialize(driverId: string | null, force = false) {
    if (driverId === this.owner && !force) return;
    this.owner = driverId;
    this.ownerEpoch = this.session.getOwnerEpoch();
    const epoch = ++this.epoch;
    this.publish({ pending: null, restoring: !!driverId, busy: false, error: null, message: null });
    if (!driverId) return;
    try {
      const pending = await this.storage.readCommand(driverId);
      if (this.owns(epoch)) this.publish({ pending, restoring: false });
    } catch (error) {
      // Unknown stored command must not be replaced by a new command.
      if (this.owns(epoch)) this.publish({ error, restoring: true });
    }
  }
  async reloadStoredCommand() { if (!this.state.busy) await this.initialize(this.owner, true); }
  async advance(value: Trip) {
    const status = nextStatus(value);
    if (!status) return;
    try {
      await this.perform({ driverId: value.driverId ?? '', tripId: value.tripId, key: randomUUID(), createdAt: new Date().toISOString(), kind: 'status', body: { status, version: value.version } });
    } catch { this.publish({ error: new ApiError('CRYPTO_UNAVAILABLE') }); }
  }
  async cancel(value: Trip, reason: string) {
    if (!['CREATED', 'SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED'].includes(value.status) || !reason.trim() || reason.trim().length > 500) {
      this.publish({ error: new ApiError('INVALID_REQUEST') });
      return;
    }
    try {
      await this.perform({ driverId: value.driverId ?? '', tripId: value.tripId, key: randomUUID(), createdAt: new Date().toISOString(), kind: 'cancel', body: { reason: reason.trim(), version: value.version } });
    } catch { this.publish({ error: new ApiError('CRYPTO_UNAVAILABLE') }); }
  }
  async retry() { if (this.state.pending) await this.perform(this.state.pending, true); }
  private async perform(candidate: TripCommand, retry = false) {
    if (this.state.busy || this.state.restoring || (!retry && this.state.pending)) return;
    if (!this.owns(this.epoch) || !this.owner || candidate.driverId !== this.owner || this.session.getSnapshot().session?.driver.driverId !== this.owner) {
      this.publish({ error: new ApiError('FORBIDDEN', 403) });
      return;
    }
    const epoch = this.epoch;
    this.publish({ busy: true, error: null, message: null });
    try {
      if (!retry) {
        await this.storage.writeCommand(candidate.driverId, candidate);
        if (!this.owns(epoch)) return;
        this.publish({ pending: candidate });
      }
      const result = await this.trip.execute(candidate);
      if (!this.owns(epoch)) return;
      await this.storage.writeCommand(candidate.driverId, null);
      if (this.owns(epoch)) this.publish({ pending: null, message: result.replayed ? 'Dịch vụ trả lại kết quả lệnh trước. Đang đọc lại chuyến hiện tại.' : 'Đã xử lý lệnh. Đang đọc lại chuyến hiện tại.' });
    } catch (error) {
      if (!this.owns(epoch)) return;
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status) && !['REQUEST_IN_PROGRESS', 'INVALID_RESPONSE'].includes(error.code)) {
        try {
          await this.storage.writeCommand(candidate.driverId, null);
          if (this.owns(epoch)) this.publish({ pending: null });
        } catch { /* Retain the exact command if clearing its persisted state fails. */ }
        // The session resource subscription reconciles active/detail/history.
        // Do not start a separate screen-independent detail GET here.
      }
      if (this.owns(epoch)) this.publish({ error });
    } finally {
      if (this.owns(epoch)) this.publish({ busy: false });
    }
  }
  dispose() { this.unsubscribe(); void this.initialize(null); this.listeners.clear(); }
}
