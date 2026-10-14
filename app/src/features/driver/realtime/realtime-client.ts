export interface RealtimeNotice { kind: 'trip-invalidated' | 'offer-invalidated' | 'reconnected' | 'disconnected' | 'error' }
export type ConnectionState = 'unconfigured' | 'paused' | 'connecting' | 'connected' | 'retrying' | 'error';
export interface RealtimeConnections { offers: ConnectionState; trips: ConnectionState }
