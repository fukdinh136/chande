import type { UserClient } from './clients';
import type { Place, SavedAddress, UserProfile } from './models';
import { Store } from './store';

export interface AccountState {
  profile: UserProfile | null;
  addresses: SavedAddress[] | null;
  loadingProfile: boolean;
  loadingAddresses: boolean;
  error: unknown;
  /** Vị trí vừa chọn ở màn chọn điểm cho form địa chỉ đã lưu. */
  draftPlace: Place | null;
}

const initial: AccountState = { profile: null, addresses: null, loadingProfile: false, loadingAddresses: false, error: null, draftPlace: null };

export class AccountStore extends Store<AccountState> {
  constructor(private readonly users: UserClient) {
    super(initial);
  }

  reset() {
    this.state = initial;
    this.set({});
  }

  async refreshProfile() {
    this.set({ loadingProfile: true, error: null });
    try {
      this.set({ profile: await this.users.me(), loadingProfile: false });
    } catch (error) {
      this.set({ loadingProfile: false, error });
    }
  }

  async refreshAddresses() {
    this.set({ loadingAddresses: true, error: null });
    try {
      this.set({ addresses: await this.users.addresses(), loadingAddresses: false });
    } catch (error) {
      this.set({ loadingAddresses: false, error });
    }
  }

  setProfile(profile: UserProfile) {
    this.set({ profile });
  }

  setDraftPlace(place: Place | null) {
    this.set({ draftPlace: place });
  }
}
