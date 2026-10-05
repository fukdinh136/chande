import { DriverError } from "../../domain/value-objects/error";
import { Otp } from "../../application/ports/otp.port";
export class HttpOtp implements Otp {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly timeout: number,
  ) {}
  private async post(path: string, body: object) {
    try {
      const response = await fetch(`${this.url}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
      });
      if (response.status === 429) throw new DriverError("RATE_LIMITED");
      if (response.status === 401)
        throw new DriverError("AUTHENTICATION_FAILED");
      if (!response.ok) throw new Error("provider");
      return await response.json();
    } catch (error) {
      if (error instanceof DriverError) throw error;
      throw new DriverError("DEPENDENCY_UNAVAILABLE");
    }
  }
  async request(phone: string, ip: string) {
    const result = (await this.post("/challenges", {
      phoneNumber: phone,
      ip,
      purpose: "LOGIN",
    })) as {
      challengeId: string;
      expiresIn: number;
      retryAfterSeconds: number;
    };
    if (
      !/^[0-9a-f-]{36}$/i.test(result.challengeId) ||
      !Number.isInteger(result.expiresIn) ||
      result.expiresIn < 1 ||
      !Number.isInteger(result.retryAfterSeconds) ||
      result.retryAfterSeconds < 0
    )
      throw new DriverError("DEPENDENCY_UNAVAILABLE");
    return {
      challengeId: result.challengeId,
      expiresIn: result.expiresIn,
      retryAfterSeconds: result.retryAfterSeconds,
    };
  }
  async consume(phone: string, challengeId: string, code: string) {
    const result = (await this.post("/challenges/consume", {
      phoneNumber: phone,
      challengeId,
      otp: code,
      purpose: "LOGIN",
    })) as { consumed?: boolean };
    if (result.consumed !== true)
      throw new DriverError("AUTHENTICATION_FAILED");
  }
}
