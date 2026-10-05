import { ApiError } from '../http/errors';

export interface Position { latitude: number; longitude: number; accuracy: number | null; capturedAt: string }
export interface RealtimeNotice { kind: 'trip-invalidated' | 'reconnected' | 'disconnected' | 'error' }
export interface RealtimeClient {
  readonly capabilities: { tripNotifications: boolean; gps: boolean; presence: boolean };
  readonly reason: string;
  connect(): Promise<void>;
  disconnect(): void;
  subscribe(listener: (notice: RealtimeNotice) => void): () => void;
  sendPosition(position: Position): Promise<void>;
}
// Local application interface, not a proposed wire event/ACK contract.
export class UnconfiguredRealtimeClient implements RealtimeClient {
  readonly capabilities = { tripNotifications: false, gps: false, presence: false };
  readonly reason = 'Thông báo chuyến realtime chưa kết nối. GPS foreground được bật riêng trên màn hình tài xế.';
  async connect() {}
  disconnect() {}
  subscribe(_listener: (notice: RealtimeNotice) => void) { return () => {}; }
  async sendPosition(_position: Position): Promise<void> { throw new ApiError('REALTIME_NOT_CONFIGURED'); }
}
