import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { command, object, string } from '../contracts/decode';
import type { TripCommand } from '../contracts/models';
import { ApiError } from '../http/errors';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';

export interface StoredCredential {
  token: string;
  driverId: string | null;
  refreshExpiresAt: string | null;
  refreshState: 'ready' | 'uncertain';
}
export interface TokenStorage {
  read(): Promise<StoredCredential | null>;
  write(value: StoredCredential | null): Promise<void>;
}
export class DriverStorage implements TokenStorage {
  private memory = new Map<string, string>();
  private writes = new Map<string, Promise<void>>();
  private commandEnvironment: Promise<string> | null = null;
  readonly persistent = Platform.OS !== 'web';
  constructor(private readonly scope: string, private readonly tripScope = scope, private readonly legacyCommandsSafe = true) {}
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
  async read(): Promise<StoredCredential | null> {
    const raw = await this.get('chande.driver.refresh');
    if (!raw) return null;
    try {
      const value = object(JSON.parse(raw));
      if (value.scope !== this.scope || value.signedOut === true) return null;
      const token = string(value.token);
      if (token.length < 32 || token.length > 256 || (value.refreshState !== undefined && !['ready', 'uncertain'].includes(string(value.refreshState)))) throw new Error('invalid');
      const driverId = value.driverId == null ? null : string(value.driverId);
      if (driverId && !/^[0-9a-f-]{36}$/i.test(driverId)) throw new Error('invalid');
      const refreshExpiresAt = value.refreshExpiresAt == null ? null : string(value.refreshExpiresAt);
      if (refreshExpiresAt && !Number.isFinite(Date.parse(refreshExpiresAt))) throw new Error('invalid');
      return { token, driverId, refreshExpiresAt, refreshState: value.refreshState === 'uncertain' ? 'uncertain' : 'ready' };
    } catch { throw new ApiError('CREDENTIAL_STORAGE_INVALID'); }
  }
  async write(value: StoredCredential | null) {
    if (value) return this.set('chande.driver.refresh', JSON.stringify({ scope: this.scope, ...value }));
    try { await this.set('chande.driver.refresh', null); }
    catch {
      // A credential-free tombstone is a fallback if native deletion fails.
      await this.set('chande.driver.refresh', JSON.stringify({ scope: this.scope, signedOut: true }));
    }
  }
  async readCommand(driverId: string): Promise<TripCommand | null> {
    const key = await this.commandKey(driverId);
    let raw = await this.get(key), legacy = false;
    if (raw === null) { raw = await this.get(`chande.driver.command.${driverId}`); legacy = true; }
    if (!raw) return null;
    try {
      const stored = object(JSON.parse(raw));
      // Keep records from other environments intact, including legacy keys.
      if (stored.scope !== (legacy ? this.scope : this.tripScope)) return null;
      if (stored.command === null) return null;
      if (legacy && !this.legacyCommandsSafe) throw new ApiError('COMMAND_SCOPE_MISMATCH');
      const parsed = command(stored.command);
      if (parsed.driverId !== driverId) throw new Error();
      if (legacy) await this.writeCommand(driverId, parsed);
      return parsed;
    } catch (error) { if (error instanceof ApiError && error.code === 'COMMAND_SCOPE_MISMATCH') throw error; throw new ApiError('COMMAND_STORAGE_INVALID'); }
  }
  private async commandKey(driverId: string) {
    if (!this.commandEnvironment) this.commandEnvironment = digestStringAsync(CryptoDigestAlgorithm.SHA256, this.tripScope).catch(error => { this.commandEnvironment = null; throw error; });
    return `chande.driver.command.${await this.commandEnvironment}.${driverId}`;
  }
  async writeCommand(driverId: string, value: TripCommand | null) {
    // A tombstone prevents a migrated legacy record from resurrecting after clear.
    return this.set(await this.commandKey(driverId), JSON.stringify({ scope: this.tripScope, command: value }));
  }
  // Separate from credentials and Trip commands; environment is a SHA-256 scope.
  readOfferState(environment: string, driverId: string, offerId = 'current') {
    return this.get(`chande.driver.offer.${environment}.${driverId}.${offerId}`);
  }
  writeOfferState(environment: string, driverId: string, offerId: string, value: string | null) {
    return this.set(`chande.driver.offer.${environment}.${driverId}.${offerId}`, value);
  }
}
