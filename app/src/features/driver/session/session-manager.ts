import type { Session } from '../contracts/models';
import type { AuthClient } from '../clients/auth-client';
import { ApiError } from '../http/errors';
import type { HttpResult, HttpTransport, RequestSpec } from '../http/transport';
import type { TokenStorage } from './storage';

export interface SessionState { session: Session | null; restoring: boolean; error: unknown }
export class SessionManager {
  private state: SessionState = { session: null, restoring: true, error: null };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private expiresAt = 0;
  private rotation: Promise<Session> | null = null;
  private restoration: Promise<void> | null = null;
  private storageQueue: Promise<void> = Promise.resolve();
  private requests = new Set<AbortController>();
  constructor(private readonly auth: AuthClient, private readonly http: HttpTransport, private readonly storage: TokenStorage) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private persist(value: string | null) {
    const job = this.storageQueue.catch(() => {}).then(() => this.storage.write(value));
    this.storageQueue = job;
    return job;
  }
  private async install(value: Session, epoch: number) {
    if (epoch !== this.epoch) throw new ApiError('CANCELLED');
    await this.persist(value.refreshToken);
    if (epoch !== this.epoch) throw new ApiError('CANCELLED');
    this.expiresAt = Date.now() + value.expiresIn * 1000;
    this.publish({ session: value, restoring: false, error: null });
  }
  async login(phone: string, challengeId: string, otp: string) {
    const epoch = ++this.epoch;
    const value = await this.auth.verifyOtp(phone, challengeId, otp);
    try { await this.install(value, epoch); }
    catch (error) {
      // Revoke a newly issued session when local installation cannot finish.
      await this.auth.logout(value.refreshToken).catch(() => {});
      throw error;
    }
  }
  restore() {
    if (this.restoration) return this.restoration;
    const epoch = this.epoch;
    const job: Promise<void> = (async () => {
      try {
        const token = await this.storage.read();
        if (token && epoch === this.epoch) await this.install(await this.auth.refresh(token), epoch);
      } catch (error) {
        if (epoch === this.epoch) {
          // A refresh timeout has an unknown outcome. Never automatically reuse it.
          await this.persist(null).catch(() => {});
          this.publish({ session: null, error });
        }
      } finally {
        if (epoch === this.epoch) this.publish({ restoring: false });
      }
    })();
    this.restoration = job;
    return job;
  }
  private refresh(observedToken: string): Promise<Session> {
    if (this.state.session && this.state.session.accessToken !== observedToken) return Promise.resolve(this.state.session);
    if (this.rotation) return this.rotation;
    const previous = this.state.session, epoch = this.epoch;
    if (!previous) return Promise.reject(new ApiError('UNAUTHENTICATED', 401));
    const job: Promise<Session> = (async () => {
      try {
        const next = await this.auth.refresh(previous.refreshToken);
        // Logout waits for this result and revokes the newest token, without restoring UI.
        if (epoch === this.epoch) {
          try { await this.install(next, epoch); }
          catch (error) {
            if (epoch !== this.epoch) return next;
            await this.auth.logout(next.refreshToken).catch(() => {});
            throw error;
          }
        }
        return next;
      } catch (error) {
        if (epoch === this.epoch) {
          this.epoch++;
          this.publish({ session: null, error });
          for (const request of this.requests) request.abort();
          await this.persist(null).catch(() => {});
        }
        throw error;
      }
    })();
    this.rotation = job;
    const finish = () => { if (this.rotation === job) this.rotation = null; };
    void job.then(finish, finish);
    return job;
  }
  async request(spec: RequestSpec): Promise<HttpResult> {
    const epoch = this.epoch;
    let session = this.state.session;
    if (!session) throw new ApiError('UNAUTHENTICATED', 401);
    if (this.expiresAt - Date.now() < 30000) session = await this.refresh(session.accessToken);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    spec.signal?.addEventListener('abort', cancel, { once: true });
    if (spec.signal?.aborted || epoch !== this.epoch) cancel();
    this.requests.add(controller);
    try {
      let result: HttpResult;
      try { result = await this.http.send({ ...spec, signal: controller.signal }, session.accessToken); }
      catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401 || controller.signal.aborted) throw error;
        // Trip trust errors should not revoke a valid Driver session or rotate forever.
        if (spec.service === 'trip') throw error;
        session = await this.refresh(session.accessToken);
        if (epoch !== this.epoch) throw new ApiError('CANCELLED');
        result = await this.http.send({ ...spec, signal: controller.signal }, session.accessToken);
      }
      if (epoch !== this.epoch || controller.signal.aborted) throw new ApiError('CANCELLED');
      return result;
    } finally {
      this.requests.delete(controller);
      spec.signal?.removeEventListener('abort', cancel);
    }
  }
  async logout() {
    const previous = this.state.session, rotation = this.rotation;
    const epoch = ++this.epoch;
    this.expiresAt = 0;
    for (const request of this.requests) request.abort();
    this.publish({ session: null, restoring: false, error: null });
    let failure: unknown;
    try { await this.persist(null); } catch (error) { failure = error; }
    const newest = rotation ? await rotation.catch(() => null) : null;
    const token = newest?.refreshToken ?? previous?.refreshToken;
    if (token) {
      try { await this.auth.logout(token); } catch (error) { failure ??= error; }
    }
    if (failure) {
      if (epoch === this.epoch) this.publish({ error: failure });
      throw failure;
    }
  }
}
