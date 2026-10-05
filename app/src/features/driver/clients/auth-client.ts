import * as decode from '../contracts/decode';
import type { HttpConfig } from '../http/config';
import { route } from '../http/routes';
import type { HttpTransport } from '../http/transport';

export class AuthClient {
  constructor(private readonly http: HttpTransport, private readonly config: HttpConfig) {}
  async requestOtp(phoneNumber: string) {
    return decode.challenge((await this.http.send({ ...route(this.config, 'otpRequest'), method: 'POST', body: { phoneNumber } })).data);
  }
  async verifyOtp(phoneNumber: string, challengeId: string, otp: string) {
    return decode.session((await this.http.send({ ...route(this.config, 'otpVerify'), method: 'POST', body: { phoneNumber, challengeId, otp } })).data);
  }
  async refresh(refreshToken: string) {
    return decode.session((await this.http.send({ ...route(this.config, 'refresh'), method: 'POST', body: { refreshToken } })).data);
  }
  async logout(refreshToken: string) {
    await this.http.send({ ...route(this.config, 'logout'), method: 'POST', body: { refreshToken } });
  }
}
