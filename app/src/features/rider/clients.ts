import * as decode from './decode';
import { RiderError } from './errors';
import { envelopeData } from './http';
import type { AddressInput, Place, RiderTrip, TripStatus } from './models';
import type { RiderSession } from './session';

// User Service trả body trần; Trip Service bọc {data, meta}. Mọi request đi qua gateway với JWT RIDER.
export class UserClient {
  constructor(private readonly session: RiderSession) {}

  async me(signal?: AbortSignal) {
    return decode.profile((await this.session.request({ path: '/users/me', method: 'GET', signal })).body);
  }
  async updateMe(patch: { fullName?: string; avatarUrl?: string }) {
    return decode.profile((await this.session.request({ path: '/users/me', method: 'PATCH', body: patch })).body);
  }
  async changePassword(oldPassword: string, newPassword: string) {
    await this.session.request({ path: '/users/me/password', method: 'POST', body: { oldPassword, newPassword } });
  }
  async addresses(signal?: AbortSignal) {
    return decode.addresses((await this.session.request({ path: '/users/me/addresses', method: 'GET', signal })).body);
  }
  async createAddress(input: AddressInput) {
    return decode.address((await this.session.request({ path: '/users/me/addresses', method: 'POST', body: input })).body);
  }
  async updateAddress(id: string, input: AddressInput) {
    return decode.address((await this.session.request({ path: `/users/me/addresses/${encodeURIComponent(id)}`, method: 'PUT', body: input })).body);
  }
  async setDefaultAddress(id: string) {
    return decode.address((await this.session.request({ path: `/users/me/addresses/${encodeURIComponent(id)}/default`, method: 'PUT' })).body);
  }
  async deleteAddress(id: string) {
    await this.session.request({ path: `/users/me/addresses/${encodeURIComponent(id)}`, method: 'DELETE' });
  }
}

const tripPath = (id: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new RiderError('INVALID_REQUEST');
  return `/trips/${id.toLowerCase()}`;
};
// Trip từ chối trường lạ và address dài hơn 500 ký tự; chỉ gửi đúng các trường của contract.
const point = (place: Place) => ({ lat: place.lat, lng: place.lng, ...(place.address ? { address: place.address.slice(0, 500) } : {}) });

export class TripClient {
  constructor(private readonly session: RiderSession) {}

  async estimate(pickup: Place, destination: Place, vehicleType: string, signal?: AbortSignal) {
    const response = await this.session.request({
      path: '/trips/estimate', method: 'POST', body: { pickup: point(pickup), destination: point(destination), vehicleType }, signal,
    });
    return decode.quote(envelopeData(response.body));
  }
  /** R02: cùng Idempotency-Key khi thử lại sau lỗi mạng để không tạo hai chuyến. */
  async create(quoteId: string, idempotencyKey: string) {
    const response = await this.session.request({ path: '/trips', method: 'POST', body: { quoteId }, idempotencyKey });
    return { trip: decode.trip(envelopeData(response.body)), replayed: response.replayed };
  }
  async active(signal?: AbortSignal): Promise<RiderTrip | null> {
    return decode.activeTrip(envelopeData((await this.session.request({ path: '/trips/active', method: 'GET', signal })).body));
  }
  async detail(id: string, signal?: AbortSignal) {
    return decode.tripDetail(envelopeData((await this.session.request({ path: tripPath(id), method: 'GET', signal })).body));
  }
  async history(options: { cursor?: string | null; status?: Extract<TripStatus, 'COMPLETED' | 'CANCELLED'> | null; signal?: AbortSignal } = {}) {
    const response = await this.session.request({
      path: '/trips/history', method: 'GET', signal: options.signal,
      query: { limit: '20', cursor: options.cursor ?? undefined, status: options.status ?? undefined },
    });
    return decode.tripPage(envelopeData(response.body));
  }
  async cancel(id: string, reason: string, version: number, idempotencyKey: string) {
    const response = await this.session.request({ path: `${tripPath(id)}/cancel`, method: 'POST', body: { reason, version }, idempotencyKey });
    return decode.trip(envelopeData(response.body));
  }
}
