import type { SessionManager } from '../session/session-manager';
import type { ConnectionState } from './realtime-client';

// Gateway /ws is a raw WebSocket protocol, separate from Realtime Socket.IO.
export class DriverTripNotifications {
  private socket: WebSocket | null = null;
  private running = false;
  private run = 0;
  private owner = -1;
  private token: string | undefined;
  private rejected = false;
  private connecting = false;
  private lastPong = 0;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private handshake: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: () => void;
  constructor(private readonly base: string, private readonly session: SessionManager, private readonly notify: (state: ConnectionState) => void, private readonly invalidate: () => void) {
    this.unsubscribe = session.subscribe(() => {
      if (!this.running) return;
      const snapshot = session.getSnapshot();
      if (this.owner !== session.getOwnerEpoch() || !snapshot.usable) this.stop();
      else if (snapshot.session?.accessToken !== this.token) { this.close(); this.rejected = false; void this.connect(); }
    });
  }
  start() {
    if (this.running) { this.retry(); return; }
    this.running = true; this.rejected = false; this.owner = this.session.getOwnerEpoch();
    void this.connect();
  }
  retry() { if (this.running && !this.socket) { this.clearRetry(); this.rejected = false; void this.connect(); } }
  private current(run: number) { return this.running && run === this.run && this.owner === this.session.getOwnerEpoch() && this.session.getSnapshot().usable; }
  private async connect() {
    if (!this.running || this.socket || this.rejected || this.connecting) return;
    const run = ++this.run;
    this.connecting = true;
    this.token = this.session.getSnapshot().session?.accessToken;
    this.notify('connecting');
    try {
      const token = await this.session.accessToken();
      if (!this.current(run)) return;
      this.token = token;
      const socket = new WebSocket(this.base.replace(/^http/, 'ws') + '/ws'); this.socket = socket;
      const current = () => this.current(run) && this.socket === socket;
      this.handshake = setTimeout(() => { if (current()) { this.close(); this.schedule(); } }, 15000);
      socket.onopen = () => { if (current()) socket.send(JSON.stringify({ type: 'auth', token })); };
      socket.onmessage = event => {
        if (!current()) return;
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === 'auth.ok') {
            if (message.role !== 'DRIVER' || message.userId !== this.session.getSnapshot().session?.driver.driverId) { this.close(); this.rejected = true; this.notify('error'); return; }
            if (this.handshake) clearTimeout(this.handshake); this.handshake = null;
            this.failures = 0; this.lastPong = Date.now(); this.notify('connected'); this.invalidate();
            if (this.ping) clearInterval(this.ping);
            this.ping = setInterval(() => {
              if (!current()) return;
              if (Date.now() - this.lastPong > 60000) { this.close(); this.schedule(); }
              else if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
            }, 25000);
          } else if (message.type === 'pong') this.lastPong = Date.now();
          else if (message.type === 'trip.event' && message.event && typeof message.event === 'object') this.invalidate();
          else if (message.type === 'error' && message.code === 'UNAUTHENTICATED') { this.close(); this.rejected = true; this.notify('error'); }
        } catch { /* Malformed events cannot replace REST state. */ }
      };
      socket.onclose = event => {
        if (!current()) return;
        this.close();
        if (event.code === 4401 && event.reason !== 'TOKEN_EXPIRED') { this.rejected = true; this.notify('error'); }
        else this.schedule();
      };
      socket.onerror = () => { if (current()) { this.close(); this.schedule(); } };
    } catch { if (this.current(run)) { this.rejected = true; this.notify('error'); } }
    finally { if (run === this.run) this.connecting = false; }
  }
  private schedule() {
    if (!this.running || this.retryTimer || this.rejected) return;
    this.notify('retrying');
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.connect(); }, Math.min(30000, 1000 * 2 ** Math.min(this.failures++, 5)));
  }
  private clearRetry() { if (this.retryTimer) clearTimeout(this.retryTimer); this.retryTimer = null; }
  private close() {
    this.run++; this.connecting = false; this.clearRetry();
    if (this.ping) clearInterval(this.ping); this.ping = null;
    if (this.handshake) clearTimeout(this.handshake); this.handshake = null;
    const socket = this.socket; this.socket = null;
    if (socket) { socket.onopen = null; socket.onclose = null; socket.onmessage = null; socket.onerror = null; socket.close(); }
  }
  stop() { this.running = false; this.close(); this.notify('paused'); }
  dispose() { this.stop(); this.unsubscribe(); }
}
