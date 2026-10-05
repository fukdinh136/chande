import { DriverError } from "../../../domain/value-objects/error";
import { Driver } from "../../../domain/driver/driver";
import { requireDriver } from "../../../domain/driver/driver";
import { phoneNumber } from "../../../domain/value-objects/phone-number";
import { Store, Repositories } from "../../ports/unit-of-work.port";
import { Otp } from "../../ports/otp.port";
import { Tokens } from "../../ports/identity.port";
import { Runtime } from "../../ports/runtime.port";
import { profileDto } from "../profile/profile.dto";
export class AuthUseCases {
  constructor(
    private readonly store: Store,
    private readonly otp: Otp,
    private readonly tokens: Tokens,
    private readonly runtime: Runtime,

    private readonly accessTtl: number,
    private readonly refreshTtl: number,
  ) {}
  request(phone: string, ip: string) {
    return this.otp.request(phoneNumber(phone), ip);
  }
  async verify(phone: string, challengeId: string, code: string) {
    const canonical = phoneNumber(phone);
    await this.otp.consume(canonical, challengeId, code);
    const driver = await this.store.read((repo) =>
      repo.driverByPhone(canonical),
    );
    if (!driver) throw new DriverError("AUTHENTICATION_FAILED");
    requireDriver(driver);
    const session = this.material(driver);
    await this.store.transaction((repo) => repo.saveRefresh(session.record));
    return this.response(driver, session);
  }
  async refresh(token: string) {
    const result = await this.store.transaction(async (repo) => {
      const record = await repo.refresh(this.runtime.hash(token), true);
      const now = this.runtime.now();
      if (!record || record.revokedAt || record.expiresAt <= now)
        throw new DriverError("INVALID_REFRESH_TOKEN");
      const driver = await repo.driver(record.driverId);
      if (!driver) throw new DriverError("INVALID_REFRESH_TOKEN");
      const session = this.material(driver);
      record.revokedAt = now;
      await repo.saveRefresh(record);
      await repo.saveRefresh(session.record);
      return { driver, session };
    });
    return this.response(result.driver, result.session);
  }
  async logout(token: string) {
    await this.store.transaction(async (repo: Repositories) => {
      const record = await repo.refresh(this.runtime.hash(token), true);
      if (record && !record.revokedAt) {
        record.revokedAt = this.runtime.now();
        await repo.saveRefresh(record);
      }
    });
    return { loggedOut: true };
  }
  private material(driver: Driver) {
    const refreshToken = this.runtime.opaque();
    const now = this.runtime.now();
    return {
      accessToken: this.tokens.issue(driver),
      refreshToken,
      record: {
        id: this.runtime.id(),
        driverId: driver.id,
        tokenHash: this.runtime.hash(refreshToken),
        createdAt: now,
        expiresAt: new Date(now.getTime() + this.refreshTtl * 1000),
        revokedAt: null,
      },
    };
  }
  private async response(
    driver: Driver,
    session: ReturnType<AuthUseCases["material"]>,
  ) {
    return {
      accessToken: session.accessToken,
      tokenType: "Bearer",
      expiresIn: this.accessTtl,
      refreshToken: session.refreshToken,
      refreshExpiresAt: session.record.expiresAt.toISOString(),
      driver: profileDto(driver),
    };
  }
}
