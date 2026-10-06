import { randomUUID } from 'expo-crypto';
import type { TripClient } from './clients';
import { RiderError } from './errors';
import { isTerminal, type RiderTrip, type TripEvent } from './models';
import { Store } from './store';

export interface TripState {
  /** Chuyến chưa kết thúc của khách (GET /trips/active). */
  trip: RiderTrip | null;
  /** Chuyến vừa kết thúc trong phiên này, để hiện hoá đơn hoặc thông báo huỷ. */
  finished: RiderTrip | null;
  loading: boolean;
  error: unknown;
  checkedAt: number | null;
  cancelling: boolean;
  cancelError: unknown;
}

const initial: TripState = { trip: null, finished: null, loading: false, error: null, checkedAt: null, cancelling: false, cancelError: null };

// Nguồn sự thật là API Trip; sự kiện WebSocket chỉ báo "có thay đổi" và luôn được đọc lại. Không bao giờ thay một
// bản có version cao hơn bằng bản cũ (phản hồi replay của idempotency có thể là snapshot cũ).
export class TripStore extends Store<TripState> {
  private inflight: Promise<void> | null = null;
  private cancelAttempt: { tripId: string; version: number; reason: string; key: string } | null = null;

  constructor(private readonly trips: TripClient) {
    super(initial);
  }

  reset() {
    this.cancelAttempt = null;
    this.state = initial;
    this.set({});
  }

  private accept(next: RiderTrip) {
    const current = this.state.trip ?? (this.state.finished?.tripId === next.tripId ? this.state.finished : null);
    if (current && current.tripId === next.tripId && current.version > next.version) return;
    if (isTerminal(next.status)) {
      this.set({ trip: this.state.trip?.tripId === next.tripId ? null : this.state.trip, finished: next });
    } else {
      this.set({ trip: next, finished: this.state.finished?.tripId === next.tripId ? null : this.state.finished });
    }
  }

  /** Chuyến vừa tạo bằng R02. */
  adopt(trip: RiderTrip) {
    this.set({ finished: null });
    this.accept(trip);
  }

  dismissFinished() {
    this.set({ finished: null });
  }

  refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    const job = (async () => {
      this.set({ loading: true, error: null });
      try {
        const previous = this.state.trip;
        const active = await this.trips.active();
        if (active) this.accept(active);
        else if (previous) {
          // Chuyến đã kết thúc khi app không nhận được sự kiện: đọc chi tiết để biết hoàn thành hay bị huỷ.
          const detail = await this.trips.detail(previous.tripId);
          this.accept(detail.trip);
          if (!isTerminal(detail.trip.status)) this.set({ trip: null });
        }
        this.set({ loading: false, checkedAt: Date.now() });
      } catch (error) {
        this.set({ loading: false, error });
      }
    })();
    this.inflight = job;
    void job.finally(() => { if (this.inflight === job) this.inflight = null; });
    return job;
  }

  async refreshTrip(tripId: string) {
    try {
      const detail = await this.trips.detail(tripId);
      this.accept(detail.trip);
    } catch (error) {
      this.set({ error });
    }
  }

  apply(event: TripEvent) {
    const current = this.state.trip;
    if (current && event.tripId === current.tripId) {
      if (event.tripVersion > current.version) void this.refreshTrip(event.tripId);
    } else if (!current) {
      void this.refresh();
    }
  }

  /** R07. Thử lại sau lỗi mạng dùng lại đúng khoá và nội dung; conflict thì đọc lại chuyến. */
  async cancel(reason: string): Promise<boolean> {
    const trip = this.state.trip;
    const text = reason.trim();
    if (!trip || this.state.cancelling || !text) return false;
    const previous = this.cancelAttempt;
    const attempt = previous && previous.tripId === trip.tripId && previous.version === trip.version && previous.reason === text
      ? previous : { tripId: trip.tripId, version: trip.version, reason: text, key: randomUUID() };
    this.cancelAttempt = attempt;
    this.set({ cancelling: true, cancelError: null });
    try {
      const result = await this.trips.cancel(attempt.tripId, attempt.reason, attempt.version, attempt.key);
      this.cancelAttempt = null;
      this.accept(result);
      this.set({ cancelling: false });
      return true;
    } catch (error) {
      if (error instanceof RiderError && error.status >= 400 && error.status < 500 && error.status !== 429) {
        this.cancelAttempt = null;
        await this.refreshTrip(trip.tripId);
      }
      this.set({ cancelling: false, cancelError: error });
      return false;
    }
  }
}
