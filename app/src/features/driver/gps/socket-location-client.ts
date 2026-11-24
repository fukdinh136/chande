import type { DriverSocket } from '../realtime/driver-socket';
export interface GpsPayload { latitude: number; longitude: number; accuracy: number; recordedAt: string }
export interface GpsReceipt { recordedAt: string; receivedAt: string; disposition: 'STORED' | 'DUPLICATE' }
export type GpsConnection = 'paused' | 'unconfigured' | 'connecting' | 'connected' | 'retrying' | 'auth-error';
export class SocketLocationClient {
  private stopped = true;
  private run = 0;
  private release: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private pending = new Set<() => void>();
  constructor(
    private readonly connection: DriverSocket,
    private readonly notify: (connection: GpsConnection, code?: string) => void,
    private readonly connected: () => void,
  ) {}
  start() {
    this.stop();
    this.stopped = false;
    const sync = () => {
      if (this.stopped) return;
      const state = this.connection.getState();
      this.notify(state, this.connection.getCode());
      if (state === 'connected') this.connected();
      else { for (const cancel of this.pending) cancel(); this.pending.clear(); }
    };
    this.unsubscribe = this.connection.subscribe(sync);
    this.release = this.connection.acquire();
    this.connection.retry(); // Explicit GPS retry can recover an auth/config error.
    sync();
  }
  send(payload: GpsPayload): Promise<GpsReceipt> {
    const socket = this.connection.connectedSocket(), run = this.run;
    if (!socket || this.stopped) return Promise.reject(new Error('GPS_DISCONNECTED'));
    return new Promise((resolve, reject) => {
      const cancel = () => reject(new Error('GPS_STOPPED'));
      this.pending.add(cancel);
      // Drop during transport loss; never queue old GPS for reconnection replay.
      socket.volatile.timeout(5000).emit('driver.location.update', payload, (error: Error | null, reply: unknown) => {
        this.pending.delete(cancel);
        if (this.stopped || run !== this.run || !this.connection.current(socket)) { cancel(); return; }
        if (error) { reject(new Error('ACK_TIMEOUT')); return; }
        if (!reply || typeof reply !== 'object' || Array.isArray(reply)) { reject(new Error('INVALID_ACK')); return; }
        if ('error' in reply && reply.error && typeof reply.error === 'object' && 'code' in reply.error) {
          const code = reply.error.code;
          reject(new Error(typeof code === 'string' ? code : 'INVALID_ACK')); return;
        }
        if (!('data' in reply) || !reply.data || typeof reply.data !== 'object' || Array.isArray(reply.data)) { reject(new Error('INVALID_ACK')); return; }
        const data = reply.data as Record<string, unknown>;
        if (data.accepted !== true || data.recordedAt !== payload.recordedAt || typeof data.receivedAt !== 'string' ||
          !Number.isFinite(Date.parse(data.receivedAt)) || !['STORED', 'DUPLICATE'].includes(String(data.disposition))) { reject(new Error('INVALID_ACK')); return; }
        resolve({ recordedAt: payload.recordedAt, receivedAt: data.receivedAt, disposition: data.disposition as GpsReceipt['disposition'] });
      });
    });
  }
  stop() {
    this.stopped = true;
    this.run++;
    this.unsubscribe?.(); this.unsubscribe = null;
    this.release?.(); this.release = null;
    for (const cancel of this.pending) cancel();
    this.pending.clear();
  }
}
