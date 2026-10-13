import type { Session } from '../contracts/models';
import type { AuthClient } from '../clients/auth-client';
import { ApiError } from '../http/errors';
import type { HttpResult, HttpTransport, RequestSpec } from '../http/transport';
import type { StoredCredential, TokenStorage } from './storage';

export type SessionPhase = 'restoring' | 'authenticated' | 'refreshing' | 'unavailable' | 'refresh-uncertain' | 'credential-error' | 'signed-out' | 'reauth-required';
export interface SessionState {
  session: Session | null; phase: SessionPhase; restoring: boolean; usable: boolean;
  error: unknown; retryAt: number | null; canRecover: boolean;
}
type Installation = { value: Session; expiresAt: number; revokeAfterInstall?: string };
const initial = (): SessionState => ({ session: null, phase: 'restoring', restoring: true, usable: false, error: null, retryAt: null, canRecover: false });

export class SessionManager {
  private state = initial();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private resourceEpoch = 0;
  private expiresAt = 0;
  private accessRejected = false;
  private refreshedFor401 = false;
  private credential: StoredCredential | null = null;
  private pendingInstall: Installation | null = null;
  private clearPending = false;
  private rotation: Promise<Session> | null = null;
  private restoration: Promise<void> | null = null;
  private recovery: Promise<void> | null = null;
  private storageQueue: Promise<void> = Promise.resolve();
  private authRequest: AbortController | null = null;
  private requests = new Set<AbortController>();
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly auth: AuthClient, private readonly http: HttpTransport, private readonly storage: TokenStorage) {}
  getSnapshot = () => this.state;
  // Stable through rotation and temporary failures; changes on owner loss/change.
  getOwnerEpoch = () => this.epoch;
  // A temporary unusable -> usable transition rebuilds resources even if React
  // batches both snapshots into one render. It does not change command ownership.
  getResourceEpoch = () => this.resourceEpoch;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private validAccess() { return !!this.state.session && !this.accessRejected && this.expiresAt > Date.now() && !this.pendingInstall && !this.clearPending; }
  private publish(patch: Partial<SessionState>) {
    const wasUsable = this.state.usable;
    this.state = { ...this.state, ...patch };
    this.state.restoring = this.state.phase === 'restoring';
    this.state.usable = this.validAccess() && !['credential-error', 'signed-out', 'reauth-required'].includes(this.state.phase);
    if (!wasUsable && this.state.usable) this.resourceEpoch++;
    this.state.canRecover = !this.rotation && !this.restoration && !this.recovery && !this.authRequest && (this.clearPending || !!this.pendingInstall || (!this.state.usable && this.credential?.refreshState !== 'uncertain' && ['unavailable', 'credential-error'].includes(this.state.phase)));
    for (const listener of this.listeners) listener();
  }
  private persist(value: StoredCredential | null, epoch: number) {
    const job = this.storageQueue.catch(() => {}).then(() => {
      if (epoch !== this.epoch) throw new ApiError('CANCELLED');
      return this.storage.write(value);
    });
    this.storageQueue = job;
    return job;
  }
  private abortRequests() { for (const request of this.requests) request.abort(); }
  private changeOwner() {
    this.epoch++;
    this.authRequest?.abort(); this.authRequest = null;
    this.abortRequests();
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.rotation = null; this.restoration = null; this.recovery = null; this.pendingInstall = null;
    this.expiresAt = 0; this.accessRejected = false; this.refreshedFor401 = false;
    return this.epoch;
  }
  private scheduleExpiry() {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    const epoch = this.epoch;
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      if (epoch !== this.epoch) return;
      this.abortRequests();
      this.publish(this.state.phase === 'authenticated' ? { phase: 'unavailable', error: new ApiError('ACCESS_TOKEN_EXPIRED') } : {});
    }, Math.max(0, Math.min(2147483647, this.expiresAt - Date.now())));
  }
  private async saveInstallation(epoch: number) {
    const prepared = this.pendingInstall;
    if (!prepared || epoch !== this.epoch) throw new ApiError('CANCELLED');
    const value: StoredCredential = { token: prepared.value.refreshToken, driverId: prepared.value.driver.driverId, refreshExpiresAt: prepared.value.refreshExpiresAt, refreshState: 'ready' };
    try { await this.persist(value, epoch); }
    catch {
      if (epoch === this.epoch) this.publish({ phase: 'credential-error', error: new ApiError('CREDENTIAL_SAVE_FAILED') });
      throw new ApiError(epoch === this.epoch ? 'CREDENTIAL_SAVE_FAILED' : 'CANCELLED');
    }
    if (epoch !== this.epoch) throw new ApiError('CANCELLED');
    this.credential = value; this.pendingInstall = null; this.clearPending = false;
    this.expiresAt = prepared.expiresAt; this.accessRejected = false;
    this.publish({ session: prepared.value, phase: this.expiresAt > Date.now() ? 'authenticated' : 'unavailable', error: this.expiresAt > Date.now() ? null : new ApiError('ACCESS_TOKEN_EXPIRED'), retryAt: null });
    this.scheduleExpiry();
    if (prepared.revokeAfterInstall) void this.auth.logout(prepared.revokeAfterInstall).catch(() => {});
  }
  // Choosing OTP changes the UI owner, but retains the old credential until a
  // new login is installed or the user explicitly logs out.
  chooseOtpLogin = () => {
    const abandoned = this.pendingInstall?.value.refreshToken;
    this.changeOwner();
    this.publish({ session: null, phase: 'signed-out', error: null, retryAt: null });
    if (abandoned) void this.auth.logout(abandoned).catch(() => {});
  };
  async login(phone: string, challengeId: string, otp: string) {
    const abandoned = this.pendingInstall?.value.refreshToken;
    const epoch = this.changeOwner(), controller = new AbortController();
    if (abandoned) void this.auth.logout(abandoned).catch(() => {});
    this.authRequest = controller;
    this.publish({ session: null, phase: 'signed-out', error: null, retryAt: null });
    let verifying = false;
    try {
      await this.storageQueue.catch(() => {});
      const previous = this.credential ?? await this.storage.read();
      if (epoch !== this.epoch) throw new ApiError('CANCELLED');
      if (previous) {
        // Do not silently restore the previous account after a new OTP login
        // succeeds but its credential cannot be saved (including process death).
        this.credential = { ...previous, refreshState: 'uncertain' };
        await this.persist(this.credential, epoch);
        if (epoch !== this.epoch) throw new ApiError('CANCELLED');
      }
      verifying = true;
      const startedAt = Date.now();
      const value = await this.auth.verifyOtp(phone, challengeId, otp, controller.signal);
      if (epoch !== this.epoch) { void this.auth.logout(value.refreshToken).catch(() => {}); throw new ApiError('CANCELLED'); }
      this.pendingInstall = { value, expiresAt: startedAt + value.expiresIn * 1000, revokeAfterInstall: previous?.token };
      await this.saveInstallation(epoch);
    } catch (error) {
      if (!verifying && epoch === this.epoch) this.publish({ phase: 'credential-error', error });
      throw error;
    } finally { if (this.authRequest === controller) { this.authRequest = null; this.publish({}); } }
  }
  restore = () => {
    if (this.restoration) return this.restoration;
    const epoch = this.epoch;
    const job = (async () => {
      this.publish({ phase: 'restoring', error: null });
      try {
        await this.storageQueue.catch(() => {});
        const credential = await this.storage.read();
        if (epoch !== this.epoch) return;
        this.credential = credential;
        if (!credential) this.publish({ session: null, phase: 'signed-out' });
        else if (credential.refreshState === 'uncertain') this.publish({ phase: 'refresh-uncertain', error: new ApiError('REFRESH_UNCERTAIN') });
        else await this.refresh();
      } catch (error) {
        if (epoch === this.epoch && this.state.phase === 'restoring') this.publish({ phase: 'unavailable', error });
      }
    })();
    this.restoration = job;
    const finish = () => { if (this.restoration === job) { this.restoration = null; this.publish({}); } };
    void job.then(finish, finish);
    return job;
  };
  private refresh(): Promise<Session> {
    if (this.rotation) return this.rotation;
    if (!this.credential || this.credential.refreshState === 'uncertain' || this.pendingInstall || this.clearPending) return Promise.reject(new ApiError(this.credential?.refreshState === 'uncertain' ? 'REFRESH_UNCERTAIN' : 'SESSION_UNAVAILABLE'));
    const previous = this.credential, epoch = this.epoch, controller = new AbortController();
    this.authRequest = controller;
    const job = (async () => {
      let sent = false;
      try {
        const marked: StoredCredential = { ...previous, refreshState: 'uncertain' };
        // Durable write-ahead guard: process death/abort cannot prove rollback.
        await this.persist(marked, epoch);
        if (epoch !== this.epoch) throw new ApiError('CANCELLED');
        this.credential = marked;
        sent = true;
        const startedAt = Date.now(), next = await this.auth.refresh(previous.token, controller.signal);
        if (epoch !== this.epoch) { void this.auth.logout(next.refreshToken).catch(() => {}); throw new ApiError('CANCELLED'); }
        if (previous.driverId && next.driver.driverId !== previous.driverId) throw new ApiError('INVALID_RESPONSE');
        this.pendingInstall = { value: next, expiresAt: startedAt + next.expiresIn * 1000 };
        await this.saveInstallation(epoch);
        return next;
      } catch (error) {
        if (epoch === this.epoch) {
          if (this.pendingInstall) this.publish({ phase: 'credential-error', error: new ApiError('CREDENTIAL_SAVE_FAILED') });
          else if (sent && error instanceof ApiError && error.status === 401 && error.code === 'INVALID_REFRESH_TOKEN') {
            const nextEpoch = this.changeOwner();
            this.credential = null; this.clearPending = true;
            this.publish({ session: null, phase: 'reauth-required', error, retryAt: null });
            await this.clearLocal(nextEpoch);
          } else this.publish({ phase: sent ? 'refresh-uncertain' : 'credential-error', error, retryAt: error instanceof ApiError ? error.retryAt : null });
        }
        throw error;
      } finally { if (this.authRequest === controller) this.authRequest = null; }
    })();
    this.rotation = job;
    // Observers may synchronously request a token. Publish only after they can
    // join this rotation, rather than start another one with the same token.
    this.publish({ phase: 'refreshing', error: null, retryAt: null });
    const finish = () => { if (this.rotation === job) { this.rotation = null; this.publish({}); } };
    void job.then(finish, finish);
    return job;
  }
  recover = () => {
    if (this.recovery) return this.recovery;
    if (!this.state.canRecover || (this.state.retryAt !== null && Date.now() < this.state.retryAt)) return Promise.resolve();
    const epoch = this.epoch;
    const job = Promise.resolve().then(async () => {
      if (epoch !== this.epoch) return;
      if (this.clearPending) { await this.clearLocal(epoch); return; }
      if (this.pendingInstall) { await this.saveInstallation(epoch).catch(() => {}); return; }
      if (!this.credential) { await this.restore(); return; }
      // Only a credential known not to have reached refresh can be used here.
      if (this.credential.refreshState === 'ready') await this.refresh().catch(() => {});
    });
    this.recovery = job;
    this.publish({});
    const finish = () => { if (this.recovery === job) { this.recovery = null; this.publish({}); } };
    void job.then(finish, finish);
    return job;
  };
  async accessToken(signal?: AbortSignal): Promise<string> {
    const epoch = this.epoch;
    if (signal?.aborted) throw new ApiError('CANCELLED');
    if (this.rotation) {
      try { await this.rotation; } catch { /* A still-valid access token may remain usable. */ }
    } else if (this.state.session && this.credential?.refreshState === 'ready' && !this.pendingInstall && !this.clearPending && !this.accessRejected && (!this.validAccess() || this.expiresAt - Date.now() < 30000) && this.state.phase !== 'credential-error') {
      try { await this.refresh(); } catch { /* Never retry an uncertain refresh. */ }
    }
    if (epoch !== this.epoch || signal?.aborted) throw new ApiError('CANCELLED');
    if (!this.validAccess() || this.state.phase === 'credential-error') throw new ApiError(this.credential?.refreshState === 'uncertain' ? 'REFRESH_UNCERTAIN' : 'SESSION_UNAVAILABLE');
    return this.state.session!.accessToken;
  }
  async request(spec: RequestSpec): Promise<HttpResult> {
    const epoch = this.epoch, token = await this.accessToken(spec.signal);
    const controller = new AbortController(), cancel = () => controller.abort();
    spec.signal?.addEventListener('abort', cancel, { once: true });
    if (spec.signal?.aborted || epoch !== this.epoch) cancel();
    this.requests.add(controller);
    try {
      let result: HttpResult, usedToken = token;
      try { result = await this.http.send({ ...spec, signal: controller.signal }, token); }
      catch (error) {
        if (epoch !== this.epoch || controller.signal.aborted) throw new ApiError('CANCELLED');
        // Downstream 401/403 never revoke the Driver credential or start a loop.
        if (!(error instanceof ApiError) || spec.service !== 'driver' || error.status !== 401 || error.code !== 'UNAUTHENTICATED') {
          if (spec.service === 'driver' && this.state.phase === 'authenticated' && error instanceof ApiError && (['NETWORK_ERROR', 'TIMEOUT'].includes(error.code) || error.status >= 500)) this.publish({ phase: 'unavailable', error });
          throw error;
        }
        const observedCurrent = this.state.session?.accessToken === token;
        if (observedCurrent) this.accessRejected = true;
        if (this.rotation) await this.rotation;
        else if (observedCurrent) {
          if (this.refreshedFor401 || this.credential?.refreshState !== 'ready') {
            this.publish({ phase: this.credential?.refreshState === 'uncertain' ? 'refresh-uncertain' : 'unavailable', error: new ApiError('DRIVER_AUTH_REJECTED') });
            throw error;
          }
          this.refreshedFor401 = true;
          await this.refresh();
        }
        if (epoch !== this.epoch || controller.signal.aborted) throw new ApiError('CANCELLED');
        // Preserve the entire command. Non-idempotent writes are never replayed.
        if (spec.method !== 'GET' && !spec.key) throw error;
        const current = await this.accessToken(controller.signal);
        usedToken = current;
        try { result = await this.http.send({ ...spec, signal: controller.signal }, current); }
        catch (retryError) {
          if (retryError instanceof ApiError && retryError.status === 401 && retryError.code === 'UNAUTHENTICATED' && epoch === this.epoch) {
            this.accessRejected = true;
            this.publish({ phase: 'unavailable', error: new ApiError('DRIVER_AUTH_REJECTED') });
          }
          throw retryError;
        }
      }
      if (epoch !== this.epoch || controller.signal.aborted) throw new ApiError('CANCELLED');
      if (spec.service === 'driver' && usedToken === this.state.session?.accessToken && !this.accessRejected && !this.rotation) {
        this.refreshedFor401 = false;
        if (this.state.phase === 'unavailable' && this.validAccess()) this.publish({ phase: 'authenticated', error: null, retryAt: null });
      }
      return result;
    } finally {
      this.requests.delete(controller);
      spec.signal?.removeEventListener('abort', cancel);
    }
  }
  private async clearLocal(epoch: number) {
    try { await this.persist(null, epoch); if (epoch === this.epoch) { this.clearPending = false; this.publish({}); } }
    catch { if (epoch === this.epoch) this.publish({ error: new ApiError('CREDENTIAL_CLEAR_FAILED') }); }
  }
  async logout() {
    const token = this.pendingInstall?.value.refreshToken ?? this.credential?.token ?? this.state.session?.refreshToken;
    const epoch = this.changeOwner();
    this.credential = null; this.clearPending = true;
    this.publish({ session: null, phase: 'signed-out', error: null, retryAt: null });
    await this.clearLocal(epoch);
    if (token) {
      try { await this.auth.logout(token); }
      catch (error) { if (epoch === this.epoch && !this.clearPending) this.publish({ error }); }
    }
  }
  dispose() {
    this.changeOwner();
    this.publish({ session: null, phase: 'signed-out' });
    this.listeners.clear();
  }
}
