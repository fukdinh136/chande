import type { HttpConfig } from '../http/config';
import type { SessionManager } from '../session/session-manager';
import type { DriverSocket } from './driver-socket';
import { DriverTripNotifications } from './trip-notifications';
import type { RealtimeNotice, RealtimeConnections } from './realtime-client';

export class GatewayRealtimeClient {
  private running = false;
  private release: (() => void) | null = null;
  private listeners = new Set<(notice: RealtimeNotice) => void>();
  private connectionListeners = new Set<() => void>();
  private connections: RealtimeConnections;
  private trips: DriverTripNotifications | null;
  private unsubscribe: (() => void)[];
  constructor(config: HttpConfig, session: SessionManager, private readonly socket: DriverSocket) {
    this.connections = { offers: config.realtimeBase && config.matchingBase ? 'paused' : 'unconfigured', trips: config.tripEventsBase ? 'paused' : 'unconfigured' };
    this.trips = config.tripEventsBase ? new DriverTripNotifications(config.tripEventsBase, session, state => this.setConnection('trips', state), () => this.notify('trip-invalidated')) : null;
    this.unsubscribe = [socket.subscribe(() => {
      if (!this.running || this.connections.offers === 'unconfigured') return;
      const state = socket.getState();
      this.setConnection('offers', state === 'auth-error' ? 'error' : state);
      if (state === 'auth-error') this.notify('error');
      else if (state === 'retrying') this.notify('disconnected');
    }), socket.subscribeEvents(event => { if (this.running && this.release) this.notify(event === 'connected' ? 'reconnected' : event); })];
  }
  getConnections = () => this.connections;
  subscribeConnections = (listener: () => void) => { this.connectionListeners.add(listener); return () => { this.connectionListeners.delete(listener); }; };
  private setConnection(channel: keyof RealtimeConnections, state: RealtimeConnections[typeof channel]) {
    if (this.connections[channel] === state) return;
    this.connections = { ...this.connections, [channel]: state }; for (const listener of this.connectionListeners) listener();
  }
  private notify(kind: RealtimeNotice['kind']) { if (this.running) for (const listener of this.listeners) listener({ kind }); }
  subscribe = (listener: (notice: RealtimeNotice) => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  async connect() {
    if (this.running) { this.socket.retry(); this.trips?.retry(); return; }
    this.running = true; this.trips?.start();
    if (this.connections.offers !== 'unconfigured') {
      this.release = this.socket.acquire();
      const state = this.socket.getState();
      this.setConnection('offers', state === 'auth-error' ? 'error' : state);
    }
  }
  disconnect() {
    this.running = false; this.trips?.stop(); this.release?.(); this.release = null;
    if (this.connections.offers !== 'unconfigured') this.setConnection('offers', 'paused');
  }
  dispose() { this.disconnect(); this.trips?.dispose(); for (const unsubscribe of this.unsubscribe) unsubscribe(); this.listeners.clear(); this.connectionListeners.clear(); }
}
