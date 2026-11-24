import type { AuthClient } from '../clients/auth-client';
import type { OtpChallenge } from '../contracts/models';
import { ApiError } from '../http/errors';
import type { SessionManager } from './session-manager';

type Challenge = OtpChallenge & { phone: string; expiresAt: number; resendAt: number };
const canonicalPhone = (value: string) => value.trim().replace(/^\+/, '');
interface LoginState {
  phone: string; otp: string; challenge: Challenge | null; busy: boolean; error: unknown;
  remaining: number; cooldown: number; requestWait: number; verifyWait: number;
}
// Form state belongs to the Driver runtime: remounts retain server deadlines,
// but an owner change cancels callbacks and removes the previous form's notice.
export class DriverLoginManager {
  private state: LoginState = { phone: '', otp: '', challenge: null, busy: false, error: null, remaining: 0, cooldown: 0, requestWait: 0, verifyWait: 0 };
  private challenges = new Map<string, Challenge>();
  private cooldowns = new Map<string, number>();
  private requestUntil = 0;
  private verifyUntil = 0;
  private revision = 0;
  private requestOwner: number;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private views = 0;
  private unsubscribe: () => void;
  constructor(private readonly auth: AuthClient, private readonly session: SessionManager) {
    this.requestOwner = session.getOwnerEpoch();
    this.unsubscribe = session.subscribe(() => {
      if (this.requestOwner !== session.getOwnerEpoch() || session.getSnapshot().usable) {
        this.challenges.clear();
        this.revision++; this.controller?.abort(); this.controller = null;
        this.requestOwner = session.getOwnerEpoch();
        this.publish({ phone: '', otp: '', challenge: null, busy: false, error: null });
      }
    });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<LoginState> = {}) {
    const now = Date.now(), state = { ...this.state, ...patch };
    state.remaining = state.challenge ? Math.max(0, Math.ceil((state.challenge.expiresAt - now) / 1000)) : 0;
    state.cooldown = Math.max(0, Math.ceil(((this.cooldowns.get(canonicalPhone(state.phone)) ?? 0) - now) / 1000));
    state.requestWait = Math.max(0, Math.ceil((this.requestUntil - now) / 1000));
    state.verifyWait = Math.max(0, Math.ceil((this.verifyUntil - now) / 1000));
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  attach = () => {
    this.views++;
    if (!this.timer) this.timer = setInterval(() => this.publish(), 1000);
    this.publish();
    return () => { if (--this.views === 0 && this.timer) { clearInterval(this.timer); this.timer = null; } };
  };
  setPhone = (phone: string) => { if (!this.state.busy) this.publish({ phone, otp: '', challenge: this.challenges.get(canonicalPhone(phone)) ?? null, error: null }); };
  setOtp = (otp: string) => { if (!this.state.busy) this.publish({ otp }); };
  private current(revision: number) { return revision === this.revision && this.requestOwner === this.session.getOwnerEpoch(); }
  private failure(error: unknown, kind: 'request' | 'verify') {
    if (error instanceof ApiError && error.retryAt !== null) {
      if (kind === 'request') this.requestUntil = Math.max(this.requestUntil, error.retryAt);
      else this.verifyUntil = Math.max(this.verifyUntil, error.retryAt);
    }
    this.publish({ error });
  }
  requestOtp = async () => {
    this.publish();
    if (this.state.busy || this.state.cooldown || this.state.requestWait) return;
    const phone = canonicalPhone(this.state.phone);
    if (!/^[1-9]\d{8,14}$/.test(phone)) { this.publish({ error: new ApiError('INVALID_REQUEST') }); return; }
    const revision = ++this.revision, controller = new AbortController(), startedAt = Date.now();
    this.requestOwner = this.session.getOwnerEpoch(); this.controller = controller;
    this.publish({ busy: true, error: null });
    try {
      const value = await this.auth.requestOtp(phone, controller.signal);
      if (!this.current(revision)) return;
      const challenge = { ...value, phone, expiresAt: startedAt + value.expiresIn * 1000, resendAt: Date.now() + value.retryAfterSeconds * 1000 };
      this.challenges.set(phone, challenge);
      this.cooldowns.set(phone, challenge.resendAt);
      this.publish({ challenge, otp: '' });
    } catch (error) { if (this.current(revision)) this.failure(error, 'request'); }
    finally { if (this.current(revision)) { this.controller = null; this.publish({ busy: false }); } }
  };
  verifyOtp = async () => {
    this.publish();
    const { challenge, otp } = this.state;
    if (this.state.busy || !challenge || !this.state.remaining || this.state.verifyWait) return;
    if (!/^\d{6}$/.test(otp)) { this.publish({ error: new ApiError('INVALID_REQUEST') }); return; }
    const revision = ++this.revision;
    // login changes the owner synchronously; reserve that epoch before calling.
    this.requestOwner = this.session.getOwnerEpoch() + 1;
    this.publish({ busy: true, error: null });
    try { await this.session.login(challenge.phone, challenge.challengeId, otp); }
    catch (error) { if (this.current(revision)) this.failure(error, 'verify'); }
    finally { if (this.current(revision)) this.publish({ busy: false }); }
  };
  dispose() {
    this.revision++; this.controller?.abort(); this.unsubscribe();
    if (this.timer) clearInterval(this.timer);
    this.timer = null; this.listeners.clear(); this.challenges.clear(); this.cooldowns.clear();
  }
}
