import * as decode from '../contracts/decode';
import type { DesiredStatus, DriverProfile, VehicleInput } from '../contracts/models';
import type { HttpConfig } from '../http/config';
import { route } from '../http/routes';
import type { SessionManager } from '../session/session-manager';
import { ApiError, writeUncertain } from '../http/errors';

interface VehicleCreation { owner: number; input: VehicleInput; phase: 'sending' | 'uncertain'; error: unknown }

export class DriverClient {
  private creation: VehicleCreation | null = null;
  private creationListeners = new Set<() => void>();
  constructor(private readonly session: SessionManager, private readonly config: HttpConfig) {}
  getVehicleCreation = () => this.creation?.owner === this.session.getOwnerEpoch() ? this.creation : null;
  subscribeVehicleCreation = (listener: () => void) => { this.creationListeners.add(listener); return () => { this.creationListeners.delete(listener); }; };
  clearVehicleCreation = () => { if (this.getVehicleCreation()?.phase === 'uncertain') { this.creation = null; this.emitCreation(); } };
  private emitCreation() { for (const listener of this.creationListeners) listener(); }
  async profile(signal?: AbortSignal) {
    return decode.profile((await this.session.request({ ...route(this.config, 'profile'), method: 'GET', signal })).data);
  }
  async updateProfile(body: Partial<Pick<DriverProfile, 'fullName' | 'licenseNumber' | 'avatarUrl'>>) {
    return decode.profile((await this.session.request({ ...route(this.config, 'profile'), method: 'PATCH', body })).data);
  }
  async vehicles(signal?: AbortSignal) {
    return decode.vehicles((await this.session.request({ ...route(this.config, 'vehicles'), method: 'GET', signal })).data);
  }
  async createVehicle(body: VehicleInput) {
    if (this.getVehicleCreation()) throw new ApiError('VEHICLE_CREATE_PENDING');
    const attempt: VehicleCreation = { owner: this.session.getOwnerEpoch(), input: { ...body }, phase: 'sending', error: null };
    this.creation = attempt; this.emitCreation();
    try {
      const value = decode.vehicle((await this.session.request({ ...route(this.config, 'vehicles'), method: 'POST', body: attempt.input })).data);
      if (attempt.owner === this.session.getOwnerEpoch()) { this.creation = null; this.emitCreation(); }
      return value;
    } catch (error) {
      if (attempt.owner === this.session.getOwnerEpoch()) {
        this.creation = writeUncertain(error) ? { ...attempt, phase: 'uncertain', error } : null;
        this.emitCreation();
      }
      throw error;
    }
  }
  async updateVehicle(id: string, body: Partial<VehicleInput> & { isActive?: boolean }) {
    return decode.vehicle((await this.session.request({ ...route(this.config, 'vehicle', id), method: 'PATCH', body })).data);
  }
  async availability(signal?: AbortSignal) {
    return decode.availability((await this.session.request({ ...route(this.config, 'availability'), method: 'GET', signal })).data);
  }
  async selectVehicle(vehicleId: string) {
    return decode.availability((await this.session.request({ ...route(this.config, 'selection'), method: 'PUT', body: { vehicleId } })).data);
  }
  async setAvailability(desiredStatus: DesiredStatus) {
    return decode.availability((await this.session.request({ ...route(this.config, 'availability'), method: 'PUT', body: { desiredStatus } })).data);
  }
}
