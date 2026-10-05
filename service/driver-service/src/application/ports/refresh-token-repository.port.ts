import { RefreshToken } from "../../domain/value-objects/session";
export interface RefreshTokenRepository {
  refresh(hash: string, lock?: boolean): Promise<RefreshToken | null>;
  saveRefresh(token: RefreshToken): Promise<void>;
}
