export interface Otp {
  request(
    phone: string,
    ip: string,
  ): Promise<{
    challengeId: string;
    expiresIn: number;
    retryAfterSeconds: number;
  }>;
  consume(phone: string, challengeId: string, code: string): Promise<void>;
}
