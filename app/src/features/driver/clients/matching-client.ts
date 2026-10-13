import { ApiError } from '../http/errors';
import { BackendError, id } from '../../backend/http';
import { offer, type Offer } from '../../backend/clients';
import { receipt, type OfferAction, type OfferDecision, type OfferReceipt } from '../contracts/offer-workflow';
import type { HttpConfig } from '../http/config';
import type { SessionManager } from '../session/session-manager';

// Both direct and Gateway adapters follow Matching's public DRIVER contract.
export interface MatchingClient {
  readonly available: boolean;
  readonly reason: string;
  active(signal?: AbortSignal): Promise<Offer | null>;
  detail(offerId: string, signal?: AbortSignal): Promise<Offer>;
  prepare(value: Offer, action: OfferAction, key: string): OfferDecision;
  execute(command: OfferDecision, signal?: AbortSignal): Promise<OfferReceipt>;
}
export class DriverMatchingClient implements MatchingClient {
  constructor(private readonly config: HttpConfig, private readonly session: SessionManager) {}
  // Configuration only; runtime availability is determined by REST results.
  get available() { return this.config.capabilities.matching.configured; }
  get reason() { return this.config.capabilities.matching.reason; }
  private async call<T>(work: () => Promise<T>) {
    if (!this.available) throw new ApiError('MATCHING_NOT_CONFIGURED');
    try { return await work(); }
    catch (error) { if (error instanceof BackendError) throw new ApiError(error.code, error.status, error.requestId); throw error; }
  }
  async active(signal?: AbortSignal) {
    return this.call(async () => offer((await this.session.request({ service: 'matching', path: `${this.config.matchingPrefix}/matching/offers/active`, method: 'GET', signal })).data));
  }
  async detail(offerId: string, signal?: AbortSignal) {
    return this.call(async () => {
      const value = offer((await this.session.request({ service: 'matching', path: `${this.config.matchingPrefix}/matching/offers/${id(offerId)}`, method: 'GET', signal })).data);
      if (!value || value.offerId !== id(offerId)) throw new ApiError('INVALID_RESPONSE');
      return value;
    });
  }
  prepare(value: Offer, action: OfferAction, key: string): OfferDecision {
    if (!this.available || !this.config.matchingBase) throw new ApiError('MATCHING_NOT_CONFIGURED');
    return { offerId: value.offerId, tripId: value.tripId, driverId: value.driverId, version: value.version, action, key: id(key), origin: this.config.matchingBase, path: `${this.config.matchingPrefix}/matching/offers/${id(value.offerId)}/${action}`, method: 'POST', body: {} };
  }
  async execute(command: OfferDecision, signal?: AbortSignal) {
    return this.call(async () => {
      if (command.origin !== this.config.matchingBase || command.path !== `${this.config.matchingPrefix}/matching/offers/${id(command.offerId)}/${command.action}` || command.driverId !== this.session.getSnapshot().session?.driver.driverId || command.method !== 'POST' || Object.keys(command.body).length) throw new ApiError('OFFER_COMMAND_SCOPE');
      const result = await this.session.request({ service: 'matching', path: command.path, method: command.method, body: command.body, key: command.key, signal });
      return receipt(result.data, command.offerId, command.action);
    });
  }
}
