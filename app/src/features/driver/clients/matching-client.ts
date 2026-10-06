import { ApiError } from '../http/errors';
import { BackendError, BackendHttp } from '../../backend/http';
import { OfferApi, type Offer } from '../../backend/clients';
import type { SessionManager } from '../session/session-manager';

// Gateway adapter follows Matching's published DRIVER contract.
export interface MatchingClient {
  readonly available: boolean;
  readonly reason: string;
  active(signal?: AbortSignal): Promise<Offer | null>;
  accept(offerId: string, key: string): Promise<void>;
  decline(offerId: string, key: string): Promise<void>;
}
export class UnconfiguredMatchingClient implements MatchingClient {
  readonly available = false;
  readonly reason = 'Chưa có kết nối Matching chính thức. Không có thao tác nhận hoặc từ chối offer.';
  async active(): Promise<Offer | null> { return null; }
  async accept(_offerId: string): Promise<void> { throw new ApiError('MATCHING_NOT_CONFIGURED'); }
  async decline(_offerId: string): Promise<void> { throw new ApiError('MATCHING_NOT_CONFIGURED'); }
}
export class GatewayMatchingClient implements MatchingClient {
  readonly available = true;
  readonly reason = 'Matching đã kết nối qua Gateway; nhận cuốc cần Trip xác nhận ASSIGNED.';
  private readonly api: OfferApi;
  constructor(base: string, private readonly session: SessionManager) { this.api = new OfferApi(new BackendHttp(base)); }
  private async call<T>(work: () => Promise<T>) { try { return await work(); } catch (error) { if (error instanceof BackendError) throw new ApiError(error.code,error.status,error.requestId); throw error; } }
  async active(signal?: AbortSignal) { return this.call(async () => this.api.active(await this.session.accessToken(signal),signal)); }
  async accept(offerId: string,key: string) { await this.call(async () => this.api.decide(await this.session.accessToken(),offerId,key,'accept')); }
  async decline(offerId: string,key: string) { await this.call(async () => this.api.decide(await this.session.accessToken(),offerId,key,'decline')); }
}
