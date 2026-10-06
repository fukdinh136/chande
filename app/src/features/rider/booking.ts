import { randomUUID } from 'expo-crypto';
import { toLngLat } from '../navigation/geo';
import type { PlannedRoute } from '../navigation/model';
import type { RouteProvider } from '../navigation/providers';
import type { TripClient } from './clients';
import { RiderError } from './errors';
import type { Place, Quote, RiderTrip } from './models';
import { Store } from './store';
import { PREFERRED_VEHICLES } from './vehicles';

export interface QuoteState { status: 'loading' | 'ready' | 'error'; quote: Quote | null; error: unknown }
export interface BookingState {
  pickup: Place | null;
  /** Điểm đón lấy từ GPS (tự cập nhật lại được) hay do người dùng chọn. */
  pickupFromGps: boolean;
  destination: Place | null;
  quotes: Record<string, QuoteState>;
  selected: string | null;
  route: PlannedRoute | null;
  routeError: unknown;
  creating: boolean;
  createError: unknown;
}

const initial: BookingState = {
  pickup: null, pickupFromGps: false, destination: null, quotes: {}, selected: null,
  route: null, routeError: null, creating: false, createError: null,
};

/** Bản nháp đặt chuyến: điểm đón/đến, báo giá R01 cho từng loại xe, tuyến để vẽ bản đồ, tạo chuyến R02. */
export class BookingStore extends Store<BookingState> {
  private generation = 0;
  /** Giữ Idempotency-Key cho đúng báo giá để thử lại sau lỗi mạng không tạo chuyến thứ hai. */
  private pending: { quoteId: string; key: string } | null = null;

  constructor(
    private readonly trips: TripClient,
    private readonly routes: RouteProvider | null,
    private readonly vehicleTypes: string[],
  ) {
    super(initial);
  }

  setPickup(place: Place, fromGps = false) {
    this.set({ pickup: place, pickupFromGps: fromGps });
    void this.refresh();
  }

  setDestination(place: Place) {
    this.set({ destination: place });
    void this.refresh();
  }

  clearDestination() {
    this.generation++;
    this.pending = null;
    this.set({ destination: null, quotes: {}, selected: null, route: null, routeError: null, createError: null });
  }

  select(vehicleType: string) {
    if (this.state.quotes[vehicleType]?.status === 'ready') this.set({ selected: vehicleType, createError: null });
  }

  reset() {
    this.generation++;
    this.pending = null;
    this.state = initial;
    this.set({});
  }

  /** Lấy lại báo giá mọi loại xe và tuyến; kết quả cũ bị bỏ khi điểm đã đổi. */
  async refresh() {
    const { pickup, destination } = this.state;
    if (!pickup || !destination) return;
    const generation = ++this.generation;
    const loading: Record<string, QuoteState> = {};
    for (const type of this.vehicleTypes) loading[type] = { status: 'loading', quote: this.state.quotes[type]?.quote ?? null, error: null };
    this.set({ quotes: loading, createError: null });
    void this.loadRoute(generation, pickup, destination);
    await Promise.all(this.vehicleTypes.map(async (type) => {
      let next: QuoteState;
      try {
        next = { status: 'ready', quote: await this.trips.estimate(pickup, destination, type), error: null };
      } catch (error) {
        next = { status: 'error', quote: null, error };
      }
      if (generation !== this.generation) return;
      const quotes = { ...this.state.quotes, [type]: next };
      const selected = this.state.selected && quotes[this.state.selected]?.status === 'ready' ? this.state.selected
        : PREFERRED_VEHICLES.find((code) => quotes[code]?.status === 'ready') ?? this.vehicleTypes.find((code) => quotes[code]?.status === 'ready') ?? null;
      this.set({ quotes, selected });
    }));
  }

  private async loadRoute(generation: number, pickup: Place, destination: Place) {
    if (!this.routes) return;
    this.set({ routeError: null });
    try {
      const route = await this.routes.route({
        origin: toLngLat(pickup), destination: toLngLat(destination), vehicleType: this.state.selected ?? this.vehicleTypes[0] ?? 'CAR',
      });
      if (generation === this.generation) this.set({ route });
    } catch (error) {
      if (generation === this.generation) this.set({ route: null, routeError: error });
    }
  }

  selectedQuote(): Quote | null {
    const { selected, quotes } = this.state;
    return selected ? quotes[selected]?.quote ?? null : null;
  }

  /** R02. Báo giá hết hạn/đã dùng thì lấy giá mới và báo để khách xác nhận lại với giá mới. */
  async confirm(): Promise<RiderTrip | null> {
    const quote = this.selectedQuote();
    if (!quote || this.state.creating) return null;
    if (Date.parse(quote.expiresAt) <= Date.now()) {
      await this.refresh();
      this.set({ createError: new RiderError('QUOTE_EXPIRED') });
      return null;
    }
    const key = this.pending?.quoteId === quote.quoteId ? this.pending.key : randomUUID();
    this.pending = { quoteId: quote.quoteId, key };
    this.set({ creating: true, createError: null });
    try {
      const { trip } = await this.trips.create(quote.quoteId, key);
      this.pending = null;
      this.generation++;
      this.set({ creating: false, destination: null, quotes: {}, selected: null, route: null, routeError: null });
      return trip;
    } catch (error) {
      // Lỗi 4xx (trừ 429) là kết quả xác định: khoá đã dùng xong hoặc báo giá không còn hợp lệ.
      if (error instanceof RiderError && error.status >= 400 && error.status < 500 && error.status !== 429) this.pending = null;
      if (error instanceof RiderError && ['QUOTE_EXPIRED', 'QUOTE_ALREADY_USED', 'RESOURCE_NOT_FOUND'].includes(error.code)) await this.refresh();
      this.set({ creating: false, createError: error });
      throw error;
    }
  }
}
