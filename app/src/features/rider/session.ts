import * as decode from './decode';
import { RiderError } from './errors';
import type { ApiRequest, ApiResponse, RiderHttp } from './http';
import { readClaims } from './jwt';
import type { TokenSet } from './models';
import type { RiderStorage } from './storage';

export type SessionStatus = 'restoring' | 'signedOut' | 'signedIn';
export interface SessionState {
  status: SessionStatus;
  userId: string | null;
  /** Lỗi khiến phiên kết thúc (khôi phục thất bại, refresh bị từ chối). */
  error: unknown;
  /** Thông báo cho màn đăng nhập, ví dụ sau khi đổi mật khẩu. */
  notice: string | null;
}

const isAuthFailure = (error: unknown) =>
  error instanceof RiderError && error.status === 401 && ['UNAUTHENTICATED', 'AUTHENTICATION_REQUIRED'].includes(error.code);

// Refresh token của User Service xoay vòng và phát hiện dùng lại (A3): mọi lần refresh chạy tuần tự, token cũ
// không bao giờ được gửi lần hai. Refresh lỗi mạng có kết quả không xác định nên cũng kết thúc phiên.
export class RiderSession {
  private state: SessionState = { status: 'restoring', userId: null, error: null, notice: null };
  private readonly listeners = new Set<() => void>();
  private tokens: TokenSet | null = null;
  private expiresAt = 0;
  private epoch = 0;
  private refreshing: Promise<TokenSet> | null = null;
  private restoring: Promise<void> | null = null;

  constructor(private readonly http: RiderHttp, private readonly storage: RiderStorage) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private async install(tokens: TokenSet, epoch: number) {
    if (epoch !== this.epoch) throw new RiderError('CANCELLED');
    await this.storage.write(tokens.refreshToken);
    if (epoch !== this.epoch) throw new RiderError('CANCELLED');
    this.tokens = tokens;
    this.expiresAt = Date.now() + tokens.expiresIn * 1000;
    this.publish({ status: 'signedIn', userId: readClaims(tokens.accessToken).sub, error: null, notice: null });
  }

  private async endLocally(patch: Partial<SessionState>) {
    this.epoch++;
    this.tokens = null;
    this.expiresAt = 0;
    this.refreshing = null;
    this.publish({ status: 'signedOut', userId: null, ...patch });
    await this.storage.write(null).catch(() => {});
  }

  restore(): Promise<void> {
    if (this.restoring) return this.restoring;
    const epoch = this.epoch;
    this.restoring = (async () => {
      try {
        const stored = await this.storage.read();
        if (!stored) {
          if (epoch === this.epoch) this.publish({ status: 'signedOut' });
          return;
        }
        const response = await this.http.send({ path: '/auth/refresh', method: 'POST', body: { refreshToken: stored } });
        await this.install(decode.tokens(response.body), epoch);
      } catch (error) {
        if (epoch === this.epoch) await this.endLocally({ error: error instanceof RiderError && error.code === 'CANCELLED' ? null : error });
      }
    })();
    return this.restoring;
  }

  async login(phoneNumber: string, password: string) {
    const epoch = ++this.epoch;
    const response = await this.http.send({ path: '/auth/login', method: 'POST', body: { phoneNumber, password } });
    const tokens = decode.tokens(response.body);
    try {
      await this.install(tokens, epoch);
    } catch (error) {
      // Không lưu được phiên thì thu hồi luôn refresh token vừa cấp.
      await this.http.send({ path: '/auth/logout', method: 'POST', body: { refreshToken: tokens.refreshToken } }).catch(() => {});
      throw error;
    }
  }

  /** A1 không trả token: đăng ký xong thì đăng nhập bằng chính thông tin vừa nhập. */
  async register(phoneNumber: string, password: string, fullName: string) {
    decode.registered((await this.http.send({ path: '/auth/register', method: 'POST', body: { phoneNumber, password, fullName } })).body);
    await this.login(phoneNumber, password);
  }

  private refresh(observed: TokenSet): Promise<TokenSet> {
    if (this.tokens && this.tokens.accessToken !== observed.accessToken) return Promise.resolve(this.tokens);
    if (this.refreshing) return this.refreshing;
    const epoch = this.epoch;
    const job = (async () => {
      try {
        const response = await this.http.send({ path: '/auth/refresh', method: 'POST', body: { refreshToken: observed.refreshToken } });
        const next = decode.tokens(response.body);
        await this.install(next, epoch);
        return next;
      } catch (error) {
        if (epoch === this.epoch) await this.endLocally({ error });
        throw error instanceof RiderError && error.status === 401 ? new RiderError('UNAUTHENTICATED', 401) : error;
      }
    })();
    this.refreshing = job;
    const clear = () => { if (this.refreshing === job) this.refreshing = null; };
    void job.then(clear, clear);
    return job;
  }

  /** Access token còn hạn ít nhất 30 giây (dùng cho WebSocket và routing). */
  async accessToken(): Promise<string> {
    const current = this.tokens;
    if (!current) throw new RiderError('UNAUTHENTICATED', 401);
    if (this.expiresAt - Date.now() > 30000) return current.accessToken;
    return (await this.refresh(current)).accessToken;
  }

  /** Gửi request cần JWT; gặp 401 thì làm mới token một lần rồi gửi lại. */
  async request(spec: ApiRequest): Promise<ApiResponse> {
    const epoch = this.epoch;
    const token = await this.accessToken();
    try {
      return await this.http.send(spec, token);
    } catch (error) {
      if (!isAuthFailure(error) || epoch !== this.epoch || !this.tokens) throw error;
      const next = await this.refresh(this.tokens);
      return this.http.send(spec, next.accessToken);
    }
  }

  async logout() {
    const tokens = this.tokens;
    await this.endLocally({ error: null, notice: null });
    if (tokens) await this.http.send({ path: '/auth/logout', method: 'POST', body: { refreshToken: tokens.refreshToken } }).catch(() => {});
  }

  /** A5: thu hồi mọi refresh token; access token đã cấp vẫn còn hạn tối đa 15 phút. */
  async logoutAll() {
    await this.request({ path: '/auth/logout-all', method: 'POST' });
    await this.endLocally({ error: null, notice: 'Đã đăng xuất khỏi mọi thiết bị.' });
  }

  /** P3 thu hồi mọi phiên và không cấp token mới: kết thúc phiên trên máy này. */
  async endAfterPasswordChange() {
    await this.endLocally({ error: null, notice: 'Đã đổi mật khẩu. Vui lòng đăng nhập lại.' });
  }
}
