import { timingSafeEqual } from "node:crypto";
import { DriverError } from "../../domain/value-objects/error";
import { Otp } from "../../application/ports/otp.port";
import { Runtime } from "../../application/ports/runtime.port";
export class MockOtp implements Otp {
  private challenges = new Map<
    string,
    { phone: string; hash: string; expires: number; attempts: number }
  >();
  private phones = new Map<string, number>();
  private ips = new Map<string, { until: number; count: number }>();
  constructor(
    private readonly runtime: Runtime,
    private readonly code: string,
    private readonly ttl: number,
    private readonly cooldown: number,
    private readonly attempts: number,
  ) {}
  async request(phone: string, ip: string) {
    const now = this.runtime.now().getTime();
    for (const [id, challenge] of this.challenges)
      if (challenge.expires <= now) this.challenges.delete(id);
    for (const [number, until] of this.phones)
      if (until <= now) this.phones.delete(number);
    for (const [address, rate] of this.ips)
      if (rate.until <= now) this.ips.delete(address);
    const rate = this.ips.get(ip) ?? { until: now + 60000, count: 0 };
    if (
      this.challenges.size >= 10000 ||
      (this.phones.get(phone) ?? 0) > now ||
      rate.count >= 10
    )
      throw new DriverError("RATE_LIMITED");
    rate.count++;
    this.ips.set(ip, rate);
    this.phones.set(phone, now + this.cooldown * 1000);
    for (const [id, challenge] of this.challenges)
      if (challenge.phone === phone) this.challenges.delete(id);
    const challengeId = this.runtime.id();
    this.challenges.set(challengeId, {
      phone,
      hash: this.runtime.hash(this.code),
      expires: now + this.ttl * 1000,
      attempts: 0,
    });
    return {
      challengeId,
      expiresIn: this.ttl,
      retryAfterSeconds: this.cooldown,
    };
  }
  async consume(phone: string, id: string, code: string) {
    const challenge = this.challenges.get(id);
    if (
      !challenge ||
      challenge.expires <= this.runtime.now().getTime() ||
      challenge.attempts >= this.attempts
    ) {
      this.challenges.delete(id);
      throw new DriverError("AUTHENTICATION_FAILED");
    }
    challenge.attempts++;
    if (
      challenge.phone !== phone ||
      !timingSafeEqual(
        Buffer.from(challenge.hash),
        Buffer.from(this.runtime.hash(code)),
      )
    ) {
      if (challenge.attempts >= this.attempts) this.challenges.delete(id);
      throw new DriverError("AUTHENTICATION_FAILED");
    }
    this.challenges.delete(id);
  }
}
