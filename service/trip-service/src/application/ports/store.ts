import type { HistoryEntry, Principal, Quote, TripData } from '../../domain/models';
export type Destination = 'matching' | 'gateway' | 'notification';
export interface OutboxMessage { id: string; tripId: string; tripVersion: number; kind: 'search' | 'cancel' | 'event'; payload: Record<string, unknown> }
export interface Receipt<T> { hash: string; result: T }
export interface PageKey { requestedAt: string; tripId: string }
export interface Transaction {
  findTrip(id: string, lock?: boolean): Promise<TripData | null>;
  saveTrip(trip: TripData, expectedVersion?: number): Promise<void>;
  findQuote(id: string, lock?: boolean): Promise<Quote | null>;
  saveQuote(quote: Quote): Promise<void>;
  consumeQuote(id: string, tripId: string): Promise<void>;
  active(principal: Principal): Promise<TripData | null>;
  list(principal: Principal, limit: number, status?: string, cursor?: PageKey): Promise<TripData[]>;
  history(id: string): Promise<HistoryEntry[]>;
  addHistory(id: string, entries: HistoryEntry[]): Promise<void>;
  lockReceipt(scope: string): Promise<void>;
  receipt<T>(scope: string): Promise<Receipt<T> | null>;
  saveReceipt<T>(scope: string, hash: string, result: T): Promise<void>;
  lockInbox(id: string): Promise<void>;
  inbox<T>(id: string): Promise<Receipt<T> | null>;
  saveInbox<T>(id: string, hash: string, result: T): Promise<void>;
  enqueue(message: OutboxMessage, destinations: Destination[]): Promise<void>;
}
export interface Store { transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>; ready(): Promise<boolean> }
