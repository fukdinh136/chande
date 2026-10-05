import { ApiError } from '../http/errors';

// Deliberately has no offer shape or guessed URL until Matching publishes its contract.
export interface MatchingClient {
  readonly available: boolean;
  readonly reason: string;
  accept(offerId: string): Promise<void>;
  decline(offerId: string): Promise<void>;
}
export class UnconfiguredMatchingClient implements MatchingClient {
  readonly available = false;
  readonly reason = 'Chưa có kết nối Matching chính thức. Không có thao tác nhận hoặc từ chối offer.';
  async accept(_offerId: string): Promise<void> { throw new ApiError('MATCHING_NOT_CONFIGURED'); }
  async decline(_offerId: string): Promise<void> { throw new ApiError('MATCHING_NOT_CONFIGURED'); }
}
