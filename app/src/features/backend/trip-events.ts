export type EventSocket = Pick<WebSocket, 'onopen' | 'onmessage' | 'onclose' | 'onerror' | 'send' | 'close'>;
export type TripEventConnection = 'paused' | 'connecting' | 'connected' | 'retrying' | 'error';
interface ExpectedIdentity {role: 'RIDER' | 'DRIVER'; userId: () => string | undefined}

// Events invalidate REST only. One socket/handshake/heartbeat/retry per owner scope.
export class TripEvents {
  private socket: EventSocket | null = null;
  private stopped = true;
  private generation = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private ping: ReturnType<typeof setInterval> | undefined;
  private handshake: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private connectionListeners = new Set<() => void>();
  private state: TripEventConnection = 'paused';
  constructor(private readonly base: string, private readonly token: () => Promise<string>,
    private readonly open: (url: string) => EventSocket = url => new WebSocket(url),
    private readonly connection: (state: TripEventConnection) => void = () => {},
    private readonly identity?: ExpectedIdentity) {}
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  getConnectionSnapshot = () => this.state;
  subscribeConnection = (listener: () => void) => {this.connectionListeners.add(listener); return () => {this.connectionListeners.delete(listener);};};
  private status(state: TripEventConnection) {
    if (this.state === state) return;
    this.state = state; this.connection(state); this.connectionListeners.forEach(listener => listener());
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false; this.status('connecting'); void this.connect(this.generation);
  }
  private current(generation: number, socket?: EventSocket) {return !this.stopped && generation === this.generation && (!socket || this.socket === socket);}
  private async connect(generation: number) {
    try {
      const token = await this.token();
      if (!this.current(generation)) return;
      const socket = this.open(this.base.replace(/^http/, 'ws') + '/ws'); this.socket = socket;
      let authenticated = false, lastPong = Date.now();
      const reconnect = () => {if (this.current(generation, socket)) {this.closeSocket(); this.reconnect(generation);}};
      this.handshake = setTimeout(reconnect, 10000);
      socket.onopen = () => {if (this.current(generation, socket)) {try {socket.send(JSON.stringify({type: 'auth', token}));} catch {reconnect();}}};
      socket.onmessage = event => {
        if (!this.current(generation, socket)) return;
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === 'auth.ok') {
            if (authenticated) return;
            if (this.identity) {
              const owner = this.identity.userId();
              if (!owner || message.role !== this.identity.role || message.userId !== owner) {reconnect(); return;}
            }
            authenticated = true; lastPong = Date.now();
            if (this.handshake) clearTimeout(this.handshake); this.handshake = undefined;
            this.status('connected'); this.listeners.forEach(listener => listener());
            this.ping = setInterval(() => {
              if (!this.current(generation, socket)) return;
              if (Date.now() - lastPong > 60000) {reconnect(); return;}
              try {socket.send(JSON.stringify({type: 'ping'}));} catch {reconnect();}
            }, 25000);
          } else if (authenticated && message.type === 'pong') lastPong = Date.now();
          else if (authenticated && message.type === 'trip.event' && message.event && typeof message.event === 'object') this.listeners.forEach(listener => listener());
          else if (message.type === 'error' && message.code === 'UNAUTHENTICATED') reconnect();
        } catch { /* Malformed data cannot change Trip state. */ }
      };
      socket.onclose = reconnect;
      socket.onerror = () => {if (this.current(generation, socket)) {this.status('error'); reconnect();}};
    } catch {if (this.current(generation)) {this.status('error'); this.reconnect(generation);}}
  }
  private reconnect(generation: number) {
    if (!this.current(generation) || this.retry) return;
    this.status('retrying');
    this.retry = setTimeout(() => {this.retry = undefined; this.status('connecting'); void this.connect(generation);}, 5000);
  }
  private closeSocket() {
    if (this.ping) clearInterval(this.ping); this.ping = undefined;
    if (this.handshake) clearTimeout(this.handshake); this.handshake = undefined;
    const socket = this.socket; this.socket = null;
    if (socket) {socket.onclose = null; socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.close();}
  }
  stop() {
    this.stopped = true; this.generation++;
    if (this.retry) clearTimeout(this.retry); this.retry = undefined;
    this.closeSocket(); this.status('paused');
  }
}
