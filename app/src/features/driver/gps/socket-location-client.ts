import { io, type Socket } from 'socket.io-client';
export interface GpsPayload { latitude: number; longitude: number; accuracy: number; recordedAt: string }
export interface GpsReceipt { recordedAt: string; receivedAt: string }
// B5: renew 1 to 3 minutes before the JWT expires, at a random point, so drivers who logged in together do not all
// renew (or reconnect) in the same second. Reconnects after a lost socket are spread over 2 to 10 seconds the same way.
const RENEW_BEFORE_MIN_MS = 60000, RENEW_BEFORE_SPREAD_MS = 120000, RENEW_RETRY_MS = 15000;
export const reconnectDelay = (random = Math.random) => 2000 + Math.floor(random() * 8000);
export function renewDelay(expiresAtMs: number, now = Date.now(), random = Math.random) {
  return Math.max(5000, expiresAtMs - now - RENEW_BEFORE_MIN_MS - Math.floor(random() * RENEW_BEFORE_SPREAD_MS));
}
/** The `exp` claim of a JWT in milliseconds, or null when the token cannot be read. */
export function tokenExpiry(token: string): number | null {
  const part = token.split('.')[1]; if (!part) return null;
  try {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let bits = 0, value = 0, text = '';
    for (const char of part.replace(/=+$/, '')) {
      const index = alphabet.indexOf(char === '+' ? '-' : char === '/' ? '_' : char); if (index < 0) return null;
      value = (value << 6) | index; bits += 6;
      if (bits >= 8) { bits -= 8; text += String.fromCharCode((value >> bits) & 0xff); }
    }
    const exp = (JSON.parse(text) as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch { return null; }
}
export class SocketLocationClient {
  private socket: Socket | null = null;
  private stopped = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private renewTimer: ReturnType<typeof setTimeout> | undefined;
  private sentToken: string | null = null;
  constructor(
    private readonly baseUrl: string,
    private readonly token: () => Promise<string>,
    private readonly notify: (message: string) => void,
    private readonly connected: () => void,
    /** B5: a token valid for several more minutes; without it the socket is closed by Realtime when its JWT expires. */
    private readonly renewToken?: () => Promise<string>,
  ) {}
  start() {
    this.stopped = false;
    const socket = io(`${this.baseUrl}/realtime`, {
      transports: ['websocket'], autoConnect: false, forceNew: true,
      reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 10000,
      auth: (callback: (data: Record<string, string>) => void) => {
        void this.token().then(token => { if (!this.stopped) { this.sentToken = token; callback({ token }); } })
          .catch(() => { if (!this.stopped) { this.notify('Không xác thực được phiên GPS. Hãy kiểm tra phiên đăng nhập và cấu hình JWT.'); callback({}); } });
      },
    });
    this.socket = socket;
    socket.on('connect', () => { if (!this.stopped) { this.notify('Định vị đã kết nối. Đang chờ cập nhật vị trí.'); this.connected(); this.scheduleRenew(socket); } });
    socket.on('connect_error', () => {
      if (this.stopped) return;
      this.notify('Chưa kết nối được GPS. Đang chờ kết nối lại.');
      // Namespace authentication errors do not always trigger Manager reconnection.
      this.scheduleReconnect(socket);
    });
    socket.on('disconnect', (reason: string) => {
      if (this.stopped) return;
      if (this.renewTimer) clearTimeout(this.renewTimer); this.renewTimer = undefined;
      this.notify('Mất kết nối định vị. Đang thử kết nối lại.');
      if (reason === 'io server disconnect') this.scheduleReconnect(socket);
    });
    socket.connect();
  }
  private scheduleReconnect(socket: Socket) {
    if (this.reconnectTimer || this.stopped) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.stopped && !socket.connected) socket.connect();
    }, reconnectDelay());
  }
  private scheduleRenew(socket: Socket, delay?: number) {
    if (!this.renewToken || this.stopped) return;
    if (this.renewTimer) clearTimeout(this.renewTimer);
    const expiresAt = this.sentToken ? tokenExpiry(this.sentToken) : null; if (delay === undefined && expiresAt === null) return;
    this.renewTimer = setTimeout(() => { this.renewTimer = undefined; void this.renew(socket); }, delay ?? renewDelay(expiresAt!));
  }
  private async renew(socket: Socket) {
    try {
      const token = await this.renewToken!();
      if (this.stopped || !socket.connected) return;
      const reply: unknown = await socket.timeout(5000).emitWithAck('driver.auth.refresh', { token });
      if (!reply || typeof reply !== 'object' || !('data' in reply)) throw new Error('RENEW_REJECTED');
      this.sentToken = token; this.scheduleRenew(socket);
    } catch {
      // Try again shortly; if it never works, Realtime closes the socket at expiry and the reconnect sends a new token.
      if (!this.stopped && socket.connected) this.scheduleRenew(socket, RENEW_RETRY_MS + Math.floor(Math.random() * RENEW_RETRY_MS));
    }
  }
  send(payload: GpsPayload): Promise<GpsReceipt> {
    const socket = this.socket;
    if (!socket?.connected || this.stopped) return Promise.reject(new Error('GPS_DISCONNECTED'));
    return new Promise((resolve, reject) => {
      socket.timeout(5000).emit('driver.location.update', payload, (error: Error | null, reply: unknown) => {
        if (this.stopped) { reject(new Error('GPS_STOPPED')); return; }
        if (error) { reject(new Error('ACK_TIMEOUT')); return; }
        if (!reply || typeof reply !== 'object') { reject(new Error('INVALID_ACK')); return; }
        if ('error' in reply && reply.error && typeof reply.error === 'object' && 'code' in reply.error) {
          const code = reply.error.code;
          reject(new Error(typeof code === 'string' ? code : 'INVALID_ACK')); return;
        }
        if (!('data' in reply) || !reply.data || typeof reply.data !== 'object') { reject(new Error('INVALID_ACK')); return; }
        const data = reply.data as Record<string, unknown>;
        if (data.accepted !== true || typeof data.recordedAt !== 'string' || typeof data.receivedAt !== 'string') { reject(new Error('INVALID_ACK')); return; }
        resolve({ recordedAt: data.recordedAt, receivedAt: data.receivedAt });
      });
    });
  }
  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.renewTimer) clearTimeout(this.renewTimer);
    this.reconnectTimer = undefined; this.renewTimer = undefined;
    const socket = this.socket;
    this.socket = null;
    if (socket) { socket.removeAllListeners(); socket.disconnect(); }
  }
}
