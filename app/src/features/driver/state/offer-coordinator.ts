import { randomUUID } from 'expo-crypto';
import type { Offer } from '../../backend/clients';
import type { MatchingClient } from '../clients/matching-client';
import { offerClosed, type OfferAction, type OfferJournal } from '../contracts/offer-workflow';
import type { Trip } from '../contracts/models';
import type { Resource } from '../hooks/use-focused-resource';
import type { HttpConfig } from '../http/config';
import { ApiError } from '../http/errors';
import { OfferStorage } from '../session/offer-storage';
import type { SessionManager } from '../session/session-manager';
import type { DriverStorage } from '../session/storage';

export type OfferPhase = 'idle' | 'restoring' | 'available' | 'sending' | 'uncertain' | 'blocked' | 'awaiting-assignment' | 'confirmed' | 'closed';
export interface OfferState extends Resource<Offer | null> {
  driverId: string | null; ready: boolean; busy: boolean; phase: OfferPhase;
  remaining: number; canDecide: boolean; canAccept: boolean; canRetry: boolean;
  commandError: unknown; storageError: unknown; legacy: boolean;
}
const empty = (): OfferState => ({ driverId: null, data: undefined, loading: false, error: null, checkedAt: null, ready: false, busy: false, phase: 'restoring', remaining: 0, canDecide: false, canAccept: false, canRetry: false, commandError: null, storageError: null, legacy: false });

// Session-owned. Screens never send decisions, hold command managers or navigate
// from a command callback. GET and command revisions protect against late reads.
export class OfferCoordinator {
  private state = empty();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private ownerEpoch = -1;
  private revision = 0;
  private foreground = false;
  private store: OfferStorage | null = null;
  private held: OfferJournal | null = null;
  private seen = new Map<string, Offer>();
  private active: Resource<Trip | null> | null = null;
  private refreshActive: (() => void) | null = null;
  private read: AbortController | null = null;
  private sending: AbortController | null = null;
  private queued = false;
  private restoring = false;
  private reconciled = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextPoll = 0;
  private failures = 0;
  private unsubscribe: (() => void) | null = null;
  // Kept across session epochs: old writes finish before the next restore.
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly matching: MatchingClient, private readonly session: SessionManager, private readonly storage: DriverStorage, private readonly config: HttpConfig) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private owns(epoch: number) { return epoch === this.epoch && this.ownerEpoch === this.session.getOwnerEpoch() && !!this.state.driverId && this.session.getSnapshot().session?.driver.driverId === this.state.driverId; }
  private publish(patch: Partial<OfferState> = {}) {
    const s = { ...this.state, ...patch }, value = s.data;
    s.remaining = value ? Math.max(0, Math.ceil((Date.parse(value.expiresAt) - Date.now()) / 1000)) : 0;
    const confirmed = !!value && !!this.active?.data && !this.active.error && !!this.active.checkedAt && this.active.data.tripId === value.tripId && this.active.data.driverId === s.driverId && ['ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(this.active.data.status);
    const waiting = this.held?.receipt?.accepted || value?.status === 'ASSIGNMENT_PENDING' || value?.status === 'ASSIGNED';
    if (!s.ready) s.phase = 'restoring';
    else if (s.busy) s.phase = 'sending';
    else if (this.held?.closed || (value && offerClosed(value))) s.phase = 'closed';
    else if (confirmed && (waiting || this.held)) s.phase = 'confirmed';
    else if (waiting) s.phase = 'awaiting-assignment';
    else if (this.held?.command && !this.held.retryable) s.phase = 'blocked';
    else if (this.held) s.phase = 'uncertain';
    else s.phase = value?.status === 'PENDING' ? 'available' : 'idle';
    s.canDecide = this.foreground && s.phase === 'available' && s.remaining > 0 && !s.loading && !s.error && !s.storageError && !s.commandError;
    // A different active Trip never confirms this offer; it also blocks accept.
    s.canAccept = s.canDecide && !!this.config.tripBase && !!this.active?.checkedAt && !this.active.loading && !this.active.error && !this.active.data;
    s.canRetry = this.foreground && s.ready && this.reconciled && s.phase === 'uncertain' && !!this.held?.command && !!this.held.retryable && !s.storageError && !s.loading;
    s.legacy = !!this.held?.legacy;
    this.state = s;
    for (const listener of this.listeners) listener();
  }
  start(driverId: string, refreshActive: () => void) {
    this.stop();
    this.state = { ...empty(), driverId };
    this.ownerEpoch = this.session.getOwnerEpoch();
    this.refreshActive = refreshActive;
    this.unsubscribe = this.session.subscribe(() => { if (!this.owns(this.epoch)) this.stop(); });
    this.publish();
    void this.restore(this.epoch);
  }
  stop() {
    this.epoch++; this.revision++;
    this.ownerEpoch = -1;
    this.unsubscribe?.(); this.unsubscribe = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.read?.abort(); this.read = null;
    this.sending?.abort(); this.sending = null;
    this.foreground = false; this.restoring = false; this.reconciled = false; this.queued = false; this.failures = 0; this.nextPoll = 0;
    this.store = null; this.held = null; this.seen.clear(); this.active = null; this.refreshActive = null;
    this.state = empty(); this.publish();
  }
  setForeground(value: boolean) {
    this.foreground = value;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (value && this.state.driverId && this.matching.available) {
      this.timer = setInterval(() => {
        if (this.state.phase === 'available' && this.state.data && this.state.remaining !== Math.max(0, Math.ceil((Date.parse(this.state.data.expiresAt) - Date.now()) / 1000))) this.publish();
        if (Date.now() >= this.nextPoll) this.refresh();
      }, 1000);
    } else { this.read?.abort(); }
    if (value) this.refresh();
    this.publish();
  }
  observeActive(value: Resource<Trip | null>) { this.active = value; this.publish(); }
  private persist(value: OfferJournal, store = this.store) {
    if (!store) return Promise.reject(new ApiError('STORAGE_UNAVAILABLE'));
    const job = this.writes.catch(() => {}).then(() => store.save(value));
    this.writes = job;
    return job;
  }
  private async restore(epoch: number) {
    if (this.restoring || !this.owns(epoch)) return;
    this.restoring = true;
    this.publish({ storageError: null });
    try {
      await this.writes.catch(() => {});
      if (!this.owns(epoch)) return;
      const store = await OfferStorage.open(this.storage, this.config, this.state.driverId!);
      const held = await store.restore();
      if (!this.owns(epoch)) return;
      this.store = store; this.held = held;
      if (held) await this.persist(held, store);
      if (!this.owns(epoch)) return;
      if (held?.snapshot) this.seen.set(held.offerId, held.snapshot);
      // Restored records lock decisions, but cannot prove current assignment.
      this.publish({ ready: true, data: held?.snapshot ?? undefined });
    } catch (storageError) {
      if (this.owns(epoch)) { this.failures++; this.nextPoll = Date.now() + Math.min(60000, 5000 * 2 ** Math.min(this.failures, 3)); this.publish({ storageError }); }
    }
    finally { if (this.owns(epoch)) { this.restoring = false; if (this.state.ready) this.refresh(); } }
  }
  refresh = () => {
    if (!this.state.driverId || !this.foreground) return;
    if (!this.state.ready) { void this.restore(this.epoch); return; }
    if (!this.matching.available) return;
    if (this.read || this.sending || this.state.busy) { this.queued = true; return; }
    void this.reconcile(this.epoch);
  };
  refreshAll = () => { this.refreshActive?.(); this.refresh(); };
  private remember(value: Offer) {
    if (value.driverId !== this.state.driverId) throw new ApiError('FORBIDDEN', 403);
    const previous = this.seen.get(value.offerId);
    if (previous && previous.tripId !== value.tripId) throw new ApiError('INVALID_RESPONSE');
    if (previous && (previous.version >= value.version || offerClosed(previous) || (previous.status !== 'PENDING' && value.status === 'PENDING'))) return previous;
    this.seen.set(value.offerId, value);
    // Decided-offer tombstones are durable; the in-memory watermark map need
    // not retain every offer seen during a long foreground session.
    if (this.seen.size > 50) for (const [id, item] of this.seen) {
      if (this.seen.size <= 50) break;
      if (id !== value.offerId && id !== this.held?.offerId && offerClosed(item)) this.seen.delete(id);
    }
    return value;
  }
  private async reconcile(epoch: number) {
    const request = new AbortController(), revision = this.revision;
    this.read = request; this.queued = false;
    this.nextPoll = Infinity;
    this.publish({ loading: true });
    try {
      // A failed receipt/tombstone write must be repaired before another offer
      // can replace the in-memory workflow.
      if (this.state.storageError && this.held) {
        await this.persist(this.held);
        if (!this.owns(epoch) || revision !== this.revision) return;
        this.publish({ storageError: null });
      }
      // A held reservation is reconciled by identity, never by an arbitrary
      // active offer or by active Trip null. Expiry only closes on server proof.
      let value = this.held && !this.held.closed
        ? await this.matching.detail(this.held.offerId, request.signal)
        : await this.matching.active(request.signal);
      if (!this.owns(epoch) || request.signal.aborted || revision !== this.revision) return;
      if (!value && this.state.data?.status === 'PENDING' && !this.held) value = await this.matching.detail(this.state.data.offerId, request.signal);
      if (!this.owns(epoch) || request.signal.aborted || revision !== this.revision) return;
      if (value) {
        const stored = this.held?.offerId === value.offerId ? this.held : await this.store!.read(value.offerId);
        if (!this.owns(epoch) || revision !== this.revision) return;
        if (stored?.snapshot) this.remember(stored.snapshot);
        const previousStatus = this.seen.get(value.offerId)?.status;
        value = this.remember(value);
        this.held = stored;
        if (stored || value.status !== 'PENDING') {
          this.held = { ...(stored ?? { schema: 1, driverId: value.driverId, offerId: value.offerId, command: null, receipt: null, retryable: false, legacy: null }), snapshot: value, closed: stored?.closed || offerClosed(value) };
          // GET acceptance is authoritative even if the receipt was lost. Do
          // not fabricate a receipt, and do not replay HTTP once accepted.
          if (value.status !== 'PENDING') this.held.retryable = false;
          if (!stored || stored.snapshot?.version !== value.version || stored.closed !== this.held.closed || stored.retryable !== this.held.retryable) await this.persist(this.held);
          if (!this.owns(epoch) || revision !== this.revision) return;
          this.publish({ storageError: null });
        }
        this.publish({ data: value, ...(value.status !== 'PENDING' || !this.held ? { commandError: null } : {}) });
        if (previousStatus !== value.status && (value.status === 'ASSIGNMENT_PENDING' || value.status === 'ASSIGNED')) this.refreshActive?.();
      } else if (!this.held) this.publish({ data: null });
      this.failures = 0;
      this.publish({ error: null, checkedAt: Date.now() });
    } catch (error) {
      if (this.owns(epoch) && !request.signal.aborted && revision === this.revision) {
        this.failures++;
        const storageFailure = error instanceof ApiError && ['STORAGE_UNAVAILABLE', 'OFFER_STORAGE_INVALID'].includes(error.code);
        this.publish({ error, ...(storageFailure ? { storageError: error } : {}) });
      }
    } finally {
      if (this.owns(epoch) && this.read === request) {
        if (!request.signal.aborted) this.reconciled = true;
        this.read = null; this.publish({ loading: false });
        this.nextPoll = Date.now() + Math.min(60000, 5000 * 2 ** Math.min(this.failures, 3));
        if (this.queued) { this.queued = false; this.refresh(); }
      }
    }
  }
  decide = (action: OfferAction) => {
    this.publish(); // Recheck expiry and the current foreground/Trip gates.
    if (!this.owns(this.epoch) || !this.state.canDecide || (action === 'accept' && !this.state.canAccept) || !this.state.data) return;
    try {
      const value = this.state.data, command = this.matching.prepare(value, action, randomUUID());
      this.held = { schema: 1, driverId: value.driverId, offerId: value.offerId, snapshot: value, command, receipt: null, closed: false, retryable: true, legacy: null };
      // Lock synchronously, before storage or token refresh can yield.
      this.revision++; this.publish({ busy: true, commandError: null });
      void this.send(this.epoch);
    } catch (commandError) { this.publish({ commandError: commandError instanceof ApiError ? commandError : new ApiError('CRYPTO_UNAVAILABLE') }); }
  };
  retry = () => {
    if (!this.owns(this.epoch) || !this.state.canRetry) return;
    this.revision++; this.publish({ busy: true, commandError: null });
    void this.send(this.epoch);
  };
  private async send(epoch: number) {
    const value = this.held!, request = new AbortController();
    this.sending = request;
    try {
      // Write record AND current pointer before a command can reach the server.
      try { await this.persist(value); }
      catch (storageError) { if (this.owns(epoch)) this.publish({ storageError }); return; }
      if (!this.owns(epoch)) return;
      const received = await this.matching.execute(value.command!, request.signal);
      if (!this.owns(epoch)) return;
      this.held = { ...value, receipt: received, retryable: false, closed: !received.accepted };
      this.revision++;
      this.publish({ busy: false, commandError: null });
      try { await this.persist(this.held); }
      catch (storageError) { if (this.owns(epoch)) this.publish({ storageError }); }
    } catch (commandError) {
      if (!this.owns(epoch)) return;
      const definitive = commandError instanceof ApiError && (commandError.code === 'OFFER_COMMAND_SCOPE' || (commandError.status >= 400 && commandError.status < 500 && ![408, 429].includes(commandError.status) && commandError.code !== 'REQUEST_IN_PROGRESS'));
      this.held = { ...value, retryable: !definitive };
      this.publish({ commandError });
      try { await this.persist(this.held); }
      catch (storageError) { if (this.owns(epoch)) this.publish({ storageError }); }
    } finally {
      if (this.owns(epoch)) {
        this.sending = null; this.publish({ busy: false });
        this.refreshAll();
      }
    }
  }
}
