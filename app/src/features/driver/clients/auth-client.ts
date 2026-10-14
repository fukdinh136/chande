import * as decode from '../contracts/decode';
import type { HttpConfig } from '../http/config';
import { route } from '../http/routes';
import type { HttpTransport } from '../http/transport';
import { ApiError } from '../http/errors';

export class AuthClient {
  constructor(private readonly http: HttpTransport, private readonly config: HttpConfig) {}
  private async context<T>(context: NonNullable<ApiError['context']>, work: () => Promise<T>) {
    try { return await work(); }
    catch (error) {
      if (error instanceof ApiError) throw new ApiError(error.code, error.status, error.requestId, error.retryAt, context);
      throw error;
    }
  }
  requestOtp(phoneNumber: string, signal?: AbortSignal) {
    return this.context('otp-request', async () => decode.challenge((await this.http.send({ ...route(this.config, 'otpRequest'), method: 'POST', body: { phoneNumber }, signal })).data));
  }
  verifyOtp(phoneNumber: string, challengeId: string, otp: string, signal?: AbortSignal) {
    return this.context('otp-verify', async () => decode.session((await this.http.send({ ...route(this.config, 'otpVerify'), method: 'POST', body: { phoneNumber, challengeId, otp }, signal })).data));
  }
  refresh(refreshToken: string, signal?: AbortSignal) {
    return this.context('refresh', async () => decode.session((await this.http.send({ ...route(this.config, 'refresh'), method: 'POST', body: { refreshToken }, signal })).data));
  }
  async logout(refreshToken: string) {
    await this.context('logout', () => this.http.send({ ...route(this.config, 'logout'), method: 'POST', body: { refreshToken } }));
  }
}
