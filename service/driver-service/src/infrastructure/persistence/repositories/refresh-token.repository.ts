import { DriverRefreshToken as TokenEntity } from "../entities/driver-refresh-token.entity";
import { RefreshToken } from "../../../domain/value-objects/session";
import { EntityManager } from "typeorm";
import { RefreshTokenRepository } from "../../../application/ports/refresh-token-repository.port";
export class PostgresRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly manager: EntityManager) {}
  async refresh(hash: string, lock = false) {
    const query = this.manager
      .getRepository(TokenEntity)
      .createQueryBuilder("token")
      .addSelect("token.tokenHash")
      .where("token.tokenHash = :hash", { hash });
    if (lock) query.setLock("pessimistic_write");
    const row = await query.getOne();
    return row
      ? {
          id: row.id,
          driverId: row.driverId,
          tokenHash: row.tokenHash,
          expiresAt: row.expiresAt,
          revokedAt: row.revokedAt,
          createdAt: row.createdAt,
        }
      : null;
  }
  async saveRefresh(token: RefreshToken) {
    await this.manager.save(
      TokenEntity,
      this.manager.create(TokenEntity, token),
    );
  }
}
