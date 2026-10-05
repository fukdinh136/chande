import { io, type Socket } from 'socket.io-client';
export interface GpsPayload { latitude: number; longitude: number; accuracy: number; recordedAt: string }
export interface GpsReceipt { recordedAt: string; receivedAt: string }
export class SocketLocationClient {
  private socket: Socket | null = null;
  private stopped = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly baseUrl: string,
    private readonly token: () => Promise<string>,
    private readonly notify: (message: string) => void,
    private readonly connected: () => void,
  ) {}
  start() {
    this.stopped = false;
    const socket = io(`${this.baseUrl}/realtime`, {
      transports: ['websocket'], autoConnect: false, forceNew: true,
      reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 10000,
      auth: (callback: (data: Record<string, string>) => void) => {
        void this.token().then(token => { if (!this.stopped) callback({ token }); })
          .catch(() => { if (!this.stopped) { this.notify('Không xác thực được phiên GPS. Hãy kiểm tra phiên đăng nhập và cấu hình JWT.'); callback({}); } });
      },
    });
    this.socket = socket;
    socket.on('connect', () => { if (!this.stopped) { this.notify('Định vị đã kết nối. Đang chờ cập nhật vị trí.'); this.connected(); } });
    socket.on('connect_error', () => {
      if (this.stopped) return;
      this.notify('Chưa kết nối được GPS. Đang chờ kết nối lại.');
      // Namespace authentication errors do not always trigger Manager reconnection.
      this.scheduleReconnect(socket);
    });
    socket.on('disconnect', (reason: string) => {
      if (this.stopped) return;
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
    }, 5000);
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
    this.reconnectTimer = undefined;
    const socket = this.socket;
    this.socket = null;
    if (socket) { socket.removeAllListeners(); socket.disconnect(); }
  }
}
