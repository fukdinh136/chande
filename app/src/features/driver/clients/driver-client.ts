import * as decode from '../contracts/decode';
import type { DesiredStatus, DriverProfile, VehicleInput } from '../contracts/models';
import type { HttpConfig } from '../http/config';
import { route } from '../http/routes';
import type { SessionManager } from '../session/session-manager';

export class DriverClient {
  constructor(private readonly session: SessionManager, private readonly config: HttpConfig) {}
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
    return decode.vehicle((await this.session.request({ ...route(this.config, 'vehicles'), method: 'POST', body })).data);
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
