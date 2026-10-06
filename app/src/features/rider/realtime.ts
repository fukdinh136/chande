import * as decode from './decode';
import type { TripEvent } from './models';

export type RealtimeStatus = 'off' | 'connecting' | 'live' | 'offline';

const PING_INTERVAL_MS = 25000;
const RENEW_BEFORE_EXPIRY_MS = 60000;

// WebSocket `/ws` của API Gateway (mục 6 tài liệu gateway). Xác thực bằng tin nhắn đầu tiên {type:"auth"} để chạy
// được cả trên web; gia hạn bằng auth mới trước khi token hết hạn. Gateway không phát lại sự kiện bị lỡ, nên mỗi lần
// kết nối lại app phải đọc lại chuyến (onConnected).
export class TripRealtime {
  private socket: WebSocket | null = null;
  private status: RealtimeStatus = 'off';
  private enabled = false;
  private generation = 0;
  private attempts = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly statusListeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: TripEvent) => void>();
  private readonly connectedListeners = new Set<() => void>();

  constructor(private readonly url: string | null, private readonly token: () => Promise<string>) {}

  get available() { return this.url !== null; }
  getSnapshot = () => this.status;
  subscribe = (listener: () => void) => {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  };
  onEvent(listener: (event: TripEvent) => void) {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  }
  onConnected(listener: () => void) {
    this.connectedListeners.add(listener);
    return () => { this.connectedListeners.delete(listener); };
  }

  start() {
    if (!this.url || this.enabled) return;
    this.enabled = true;
    this.attempts = 0;
    void this.connect();
  }

  stop() {
    this.enabled = false;
    this.generation++;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000);
    this.setStatus('off');
  }

  private setStatus(status: RealtimeStatus) {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener();
  }

  private clearTimers() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private later(delay: number, job: () => void) {
    this.timers.push(setTimeout(job, delay));
  }

  private async connect() {
    const generation = ++this.generation;
    this.setStatus('connecting');
    let token: string;
    try {
      token = await this.token();
    } catch {
      if (generation === this.generation && this.enabled) this.reconnect();
      return;
    }
    if (!this.enabled || generation !== this.generation || !this.url) return;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token }));
    socket.onmessage = (message) => {
      if (generation === this.generation) this.handle(socket, typeof message.data === 'string' ? message.data : '');
    };
    socket.onerror = () => {};
    socket.onclose = (event) => {
      if (generation !== this.generation) return;
      this.clearTimers();
      this.socket = null;
      this.setStatus('offline');
      // 4429: đã có 5 kết nối cùng tài khoản; chờ lâu hơn trước khi thử lại.
      if (this.enabled) this.reconnect(event.code === 4429 ? 30000 : undefined);
    };
  }

  private handle(socket: WebSocket, raw: string) {
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      message = parsed as Record<string, unknown>;
    } catch { return; }
    if (message.type === 'auth.ok') {
      this.attempts = 0;
      this.setStatus('live');
      if (!this.pingTimer) this.pingTimer = setInterval(() => socket.send(JSON.stringify({ type: 'ping' })), PING_INTERVAL_MS);
      const expiresAt = typeof message.expiresAt === 'string' ? Date.parse(message.expiresAt) : NaN;
      if (Number.isFinite(expiresAt)) this.later(Math.max(5000, expiresAt - Date.now() - RENEW_BEFORE_EXPIRY_MS), () => { void this.renew(socket); });
      for (const listener of this.connectedListeners) listener();
    } else if (message.type === 'trip.event') {
      const event = decode.tripEvent(message.event);
      if (event) for (const listener of this.eventListeners) listener(event);
    }
  }

  private async renew(socket: WebSocket) {
    try {
      const token = await this.token();
      if (this.socket === socket) socket.send(JSON.stringify({ type: 'auth', token }));
    } catch {
      // Không gia hạn được: gateway sẽ đóng kết nối (4401) và vòng kết nối lại xử lý tiếp.
    }
  }

  private reconnect(delay?: number) {
    this.attempts++;
    const wait = delay ?? Math.min(30000, 1000 * 2 ** Math.min(this.attempts, 5));
    this.later(wait, () => { void this.connect(); });
  }
}
