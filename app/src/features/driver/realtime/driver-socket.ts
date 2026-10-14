import { io, type Socket } from 'socket.io-client';
import { REALTIME_NAMESPACE, REALTIME_SOCKET_PATH } from '../http/config';
import type { SessionManager } from '../session/session-manager';

export type DriverSocketState = 'paused' | 'unconfigured' | 'connecting' | 'connected' | 'retrying' | 'auth-error';
export type DriverSocketEvent = 'connected' | 'offer-invalidated';
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
      auth: callback => { void this.session.accessToken().then(token => { if (this.current(socket)) callback({ token }); }).catch(error => {
        if (this.current(socket)) { this.close(); this.publish('auth-error', error instanceof Error ? error.message : 'UNAUTHENTICATED'); }
      }); },
    });
    this.socket = socket;
    socket.on('connect', () => { if (this.current(socket)) { this.failures = 0; this.clearTimer(); this.publish('connected'); this.emit('connected'); } });
    for (const event of ['driver.trip.offer', 'driver.trip.offer.updated']) socket.on(event, () => { if (this.current(socket)) this.emit('offer-invalidated'); });
    socket.on('connect_error', error => {
      if (!this.current(socket)) return;
      const code = (error as Error & { data?: { code?: unknown } }).data?.code;
      if (code === 'UNAUTHENTICATED' || error.message === 'UNAUTHENTICATED') { this.close(); this.publish('auth-error', 'UNAUTHENTICATED'); }
      else { this.publish('retrying', typeof code === 'string' ? code : 'GPS_DISCONNECTED'); if (!socket.active) this.schedule(socket); }
    });
    socket.on('disconnect', reason => {
      if (this.current(socket)) { this.publish('retrying', 'GPS_DISCONNECTED'); if (reason === 'io server disconnect') this.schedule(socket); }
    });
    socket.connect();
  }
  private schedule(socket: Socket) {
    if (this.timer || !this.current(socket)) return;
    this.timer = setTimeout(() => { this.timer = null; if (this.current(socket) && !socket.connected) socket.connect(); }, Math.min(30000, 1000 * 2 ** Math.min(this.failures++, 5)));
  }
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private close() {
    this.clearTimer(); const socket = this.socket; this.socket = null;
    socket?.removeAllListeners(); socket?.disconnect();
  }
  dispose() { this.unsubscribe(); this.leases.clear(); this.close(); this.listeners.clear(); this.events.clear(); }
}
