import { io, type Socket } from 'socket.io-client';
import { REALTIME_NAMESPACE, REALTIME_SOCKET_PATH } from '../http/config';
import type { SessionManager } from '../session/session-manager';

export type DriverSocketState = 'paused' | 'unconfigured' | 'connecting' | 'connected' | 'retrying' | 'auth-error';
export type DriverSocketEvent = 'connected' | 'offer-invalidated';
// B5: renew 1 to 3 minutes before the JWT expires, at a random point, on the open socket (driver.auth.refresh), so
// drivers who logged in together neither renew nor reconnect in the same second. Realtime closes a socket whose JWT
// has expired; renewing in place keeps it open. A lost socket reconnects after a random 2 to 10 s first.
const RENEW_BEFORE_MIN_MS = 60000, RENEW_BEFORE_SPREAD_MS = 120000, RENEW_RETRY_MS = 15000, RENEW_VALIDITY_MS = 5 * 60000;
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
// GPS and offers have identical origin, namespace, path and Driver JWT auth.
// Leases prevent one consumer's cleanup from disconnecting the other.
export class DriverSocket {
  private socket: Socket | null = null;
  private leases = new Set<symbol>();
  private listeners = new Set<() => void>();
  private events = new Set<(event: DriverSocketEvent) => void>();
  private state: DriverSocketState;
  private code: string | undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private owner: number;
  private token: string | undefined;
  /** The JWT the open socket was authenticated or last renewed with. */
  private sentToken: string | undefined;
  private renewTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: () => void;
  constructor(private readonly base: string | null, private readonly session: SessionManager) {
    this.state = base ? 'paused' : 'unconfigured';
    this.owner = session.getOwnerEpoch();
    this.token = session.getSnapshot().session?.accessToken;
    this.unsubscribe = session.subscribe(() => {
      const snapshot = session.getSnapshot(), token = snapshot.session?.accessToken;
      const changedToken = this.token !== token;
      // open() can synchronously ask SessionManager for a token and publish a
      // refresh state. Record this token first to avoid re-entering re-auth.
      this.token = token;
      if (this.owner !== session.getOwnerEpoch()) {
        this.owner = session.getOwnerEpoch(); this.leases.clear(); this.close(); this.publish(base ? 'paused' : 'unconfigured');
      } else if (!snapshot.usable) { this.close(); this.publish(base ? 'paused' : 'unconfigured'); }
      else if (changedToken && this.leases.size && token && this.socket?.connected && this.current(this.socket)) void this.renewOnSocket(this.socket, token);
      else if (changedToken && this.leases.size) { this.close(); this.open(); }
    });
  }
  getState = () => this.state;
  getCode = () => this.code;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  subscribeEvents = (listener: (event: DriverSocketEvent) => void) => { this.events.add(listener); return () => { this.events.delete(listener); }; };
  private publish(state: DriverSocketState, code?: string) { this.state = state; this.code = code; for (const listener of this.listeners) listener(); }
  private emit(event: DriverSocketEvent) { for (const listener of this.events) listener(event); }
  acquire() {
    const lease = Symbol(); this.leases.add(lease);
    if (!this.socket && this.state !== 'auth-error') this.open();
    return () => { this.leases.delete(lease); if (!this.leases.size) { this.close(); this.publish(this.base ? 'paused' : 'unconfigured'); } };
  }
  current(socket: Socket) { return this.socket === socket && this.leases.size > 0 && this.owner === this.session.getOwnerEpoch() && this.session.getSnapshot().usable; }
  connectedSocket() { return this.socket?.connected && this.current(this.socket) ? this.socket : null; }
  retry = () => {
    if (!this.leases.size || this.socket?.connected) return;
    if (!this.socket) this.open();
    else if (!this.socket.active) this.socket.connect();
  };
  private open() {
    if (!this.base || !this.leases.size || !this.session.getSnapshot().usable || this.socket) return;
    this.publish('connecting');
    // A dedicated Manager isolates Customer auth; only this Driver owner creates it.
    const socket = io(this.base + REALTIME_NAMESPACE, {
      path: REALTIME_SOCKET_PATH, transports: ['websocket'], forceNew: true, autoConnect: false,
      reconnectionDelay: 1000, reconnectionDelayMax: 30000, randomizationFactor: 0.5,
      auth: callback => { void this.session.accessToken().then(token => { if (this.current(socket)) { this.sentToken = token; callback({ token }); } }).catch(error => {
        if (this.current(socket)) { this.close(); this.publish('auth-error', error instanceof Error ? error.message : 'UNAUTHENTICATED'); }
      }); },
    });
    this.socket = socket;
    socket.on('connect', () => { if (this.current(socket)) { this.failures = 0; this.clearTimer(); this.publish('connected'); this.emit('connected'); this.scheduleRenew(socket); } });
    for (const event of ['driver.trip.offer', 'driver.trip.offer.updated']) socket.on(event, () => { if (this.current(socket)) this.emit('offer-invalidated'); });
    socket.on('connect_error', error => {
      if (!this.current(socket)) return;
      const code = (error as Error & { data?: { code?: unknown } }).data?.code;
      if (code === 'UNAUTHENTICATED' || error.message === 'UNAUTHENTICATED') { this.close(); this.publish('auth-error', 'UNAUTHENTICATED'); }
      else { this.publish('retrying', typeof code === 'string' ? code : 'GPS_DISCONNECTED'); if (!socket.active) this.schedule(socket); }
    });
    socket.on('disconnect', reason => {
      if (this.current(socket)) { this.clearRenew(); this.publish('retrying', 'GPS_DISCONNECTED'); if (reason === 'io server disconnect') this.schedule(socket); }
    });
    socket.connect();
  }
  private schedule(socket: Socket) {
    if (this.timer || !this.current(socket)) return;
    // First retry at a random 2-10 s (B5), later ones back off exponentially with jitter, up to 30 s.
    const attempt = this.failures++;
    const delay = attempt === 0 ? reconnectDelay() : Math.min(30000, 1000 * 2 ** Math.min(attempt, 5) * (0.5 + Math.random()));
    this.timer = setTimeout(() => { this.timer = null; if (this.current(socket) && !socket.connected) socket.connect(); }, delay);
  }
  private scheduleRenew(socket: Socket, delay?: number) {
    this.clearRenew();
    const expiresAt = this.sentToken ? tokenExpiry(this.sentToken) : null;
    if (delay === undefined && expiresAt === null) return;
    this.renewTimer = setTimeout(() => {
      this.renewTimer = null;
      if (!this.current(socket) || !socket.connected) return;
      // A token valid for 5 more minutes; a new one reaches renewOnSocket through the session subscription.
      void this.session.accessToken(undefined, RENEW_VALIDITY_MS).then(token => {
        if (token === this.sentToken && this.current(socket)) this.scheduleRenew(socket, RENEW_RETRY_MS + Math.floor(Math.random() * RENEW_RETRY_MS));
      }).catch(() => { if (this.current(socket)) this.scheduleRenew(socket, RENEW_RETRY_MS + Math.floor(Math.random() * RENEW_RETRY_MS)); });
    }, delay ?? renewDelay(expiresAt!));
  }
  /** Moves the open socket to a new JWT without reconnecting; if Realtime refuses, reconnect with it instead. */
  private async renewOnSocket(socket: Socket, token: string) {
    try {
      const reply: unknown = await socket.timeout(5000).emitWithAck('driver.auth.refresh', { token });
      if (!this.current(socket)) return;
      if (!reply || typeof reply !== 'object' || !('data' in reply)) throw new Error('RENEW_REJECTED');
      this.sentToken = token; this.scheduleRenew(socket);
    } catch {
      if (this.current(socket) && this.token === token) { this.close(); this.open(); }
    }
  }
  private clearRenew() { if (this.renewTimer) clearTimeout(this.renewTimer); this.renewTimer = null; }
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private close() {
    this.clearTimer(); this.clearRenew(); this.sentToken = undefined; const socket = this.socket; this.socket = null;
    socket?.removeAllListeners(); socket?.disconnect();
  }
  dispose() { this.unsubscribe(); this.leases.clear(); this.close(); this.listeners.clear(); this.events.clear(); }
}
