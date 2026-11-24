import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { commandStorage } from '../../backend/command-storage';
import { id } from '../../backend/http';
import { journal, type OfferAction, type OfferJournal } from '../contracts/offer-workflow';
import type { HttpConfig } from '../http/config';
import { route } from '../http/routes';
import { ApiError } from '../http/errors';
import type { DriverStorage } from './storage';

// One pointer to the held workflow, plus a tombstone per decided offer. Closed
// records never become a new decision after restart or a late PENDING snapshot.
export class OfferStorage {
  private constructor(private readonly storage: DriverStorage, private readonly environment: string, readonly driverId: string, private readonly driverBase: string) {}
  static async open(storage: DriverStorage, config: HttpConfig, driverId: string) {
    // Trip capability/trust changes must not fork the journal for the same
    // Matching decision endpoint and accidentally permit a second command.
    const scope = JSON.stringify([config.driverBase, route(config, 'otpVerify').path, config.matchingBase, config.matchingPrefix]);
    const environment = await digestStringAsync(CryptoDigestAlgorithm.SHA256, scope);
    return new OfferStorage(storage, environment, id(driverId), config.driverBase);
  }
  async read(offerId: string) {
    const raw = await this.storage.readOfferState(this.environment, this.driverId, id(offerId));
    if (!raw) return null;
    try { return journal(JSON.parse(raw), this.driverId, id(offerId)); }
    catch { throw new ApiError('OFFER_STORAGE_INVALID'); }
  }
  async restore(): Promise<OfferJournal | null> {
    const current = await this.storage.readOfferState(this.environment, this.driverId);
    if (current) {
      const value = await this.read(id(current));
      if (!value) throw new ApiError('OFFER_STORAGE_INVALID');
      return value;
    }
    // Preserve unresolved decisions from the old screen-owned manager. Its
    // origin/version were not recorded, so it is unsafe to replay it here.
    const old = await commandStorage('driver', this.driverBase, this.driverId).read();
    if (!old) return null;
    if (!['accept', 'decline'].includes(old.operation)) throw new ApiError('OFFER_STORAGE_INVALID');
    const value: OfferJournal = { schema: 1, driverId: this.driverId, offerId: id(old.body.offerId), snapshot: null, command: null, receipt: null, closed: false, retryable: false, legacy: { key: old.key, action: old.operation as OfferAction } };
    return value;
  }
  async save(value: OfferJournal) {
    await this.storage.writeOfferState(this.environment, this.driverId, value.offerId, JSON.stringify(value));
    await this.storage.writeOfferState(this.environment, this.driverId, 'current', value.closed ? null : value.offerId);
    if (value.legacy && value.closed) await commandStorage('driver', this.driverBase, this.driverId).write(null);
  }
}
