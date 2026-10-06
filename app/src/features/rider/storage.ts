import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { RiderError } from './errors';

const KEY = 'chande.rider.session';

/** Lưu refresh token. Web chỉ giữ trong bộ nhớ (như app tài xế): tải lại trang thì đăng nhập lại. */
export class RiderStorage {
  private memory: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  readonly persistent = Platform.OS !== 'web';
  constructor(private readonly scope: string) {}

  async read(): Promise<string | null> {
    await this.queue.catch(() => {});
    let raw: string | null;
    try { raw = this.persistent ? await SecureStore.getItemAsync(KEY) : this.memory; } catch { throw new RiderError('STORAGE_UNAVAILABLE'); }
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as { scope?: unknown; refreshToken?: unknown };
      // Token của môi trường khác (đổi địa chỉ gateway) không được gửi đi.
      if (value.scope === this.scope && typeof value.refreshToken === 'string') return value.refreshToken;
    } catch { /* Dữ liệu hỏng được xoá bên dưới. */ }
    await this.write(null);
    return null;
  }

  write(refreshToken: string | null): Promise<void> {
    const value = refreshToken === null ? null : JSON.stringify({ scope: this.scope, refreshToken });
    const job = this.queue.catch(() => {}).then(async () => {
      try {
        if (!this.persistent) this.memory = value;
        else if (value === null) await SecureStore.deleteItemAsync(KEY);
        else await SecureStore.setItemAsync(KEY, value);
      } catch { throw new RiderError('STORAGE_UNAVAILABLE'); }
    });
    this.queue = job;
    return job;
  }
}
