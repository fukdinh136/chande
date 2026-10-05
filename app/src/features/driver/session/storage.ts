import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { command, object, string } from '../contracts/decode';
import type { TripCommand } from '../contracts/models';
import { ApiError } from '../http/errors';

export interface TokenStorage {
  read(): Promise<string | null>;
  write(token: string | null): Promise<void>;
}
export class DriverStorage implements TokenStorage {
  private memory = new Map<string, string>();
  private writes = new Map<string, Promise<void>>();
  readonly persistent = Platform.OS !== 'web';
  constructor(private readonly scope: string) {}
  private async get(key: string) {
    await this.writes.get(key)?.catch(() => {});
    try { return this.persistent ? await SecureStore.getItemAsync(key) : this.memory.get(key) ?? null; }
    catch { throw new ApiError('STORAGE_UNAVAILABLE'); }
  }
  private async save(key: string, value: string | null) {
    try {
      if (!this.persistent) {
        if (value === null) this.memory.delete(key); else this.memory.set(key, value);
      } else if (value === null) await SecureStore.deleteItemAsync(key);
      else await SecureStore.setItemAsync(key, value);
    } catch { throw new ApiError('STORAGE_UNAVAILABLE'); }
  }
  private set(key: string, value: string | null) {
    const operation = (this.writes.get(key) ?? Promise.resolve()).catch(() => {}).then(() => this.save(key, value));
    this.writes.set(key, operation);
    return operation.finally(() => { if (this.writes.get(key) === operation) this.writes.delete(key); });
  }
  async read() {
    const raw = await this.get('chande.driver.refresh');
    if (!raw) return null;
    try {
      const value = object(JSON.parse(raw));
      if (value.scope === this.scope) return string(value.token);
    } catch { /* Invalid local data is cleared, never sent to a service. */ }
    await this.write(null);
    return null;
  }
  write(token: string | null) {
    return this.set('chande.driver.refresh', token === null ? null : JSON.stringify({ scope: this.scope, token }));
  }
  async readCommand(driverId: string): Promise<TripCommand | null> {
    const raw = await this.get(`chande.driver.command.${driverId}`);
    if (!raw) return null;
    try {
      const stored = object(JSON.parse(raw));
      const parsed = command(stored.command);
      if (stored.scope === this.scope && parsed.driverId === driverId) return parsed;
    } catch { /* Corrupt or different-environment commands cannot be retried. */ }
    await this.writeCommand(driverId, null);
    return null;
  }
  writeCommand(driverId: string, value: TripCommand | null) {
    return this.set(`chande.driver.command.${driverId}`, value === null ? null : JSON.stringify({ scope: this.scope, command: value }));
  }
}
