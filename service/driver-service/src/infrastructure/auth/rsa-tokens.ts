import { generateKeyPairSync, createPublicKey, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { JwtService } from "@nestjs/jwt";
import { Driver } from "../../domain/driver/driver";
import { DriverError } from "../../domain/value-objects/error";
import { Principal } from "../../domain/value-objects/identity";
import { Tokens } from "../../application/ports/identity.port";
export class RsaTokens implements Tokens {
  private readonly privateKey: string;
  private readonly publicKey: string;
  private readonly jwt = new JwtService();
  private readonly kid: string;
  readonly jwks: { keys: object[] };
  constructor(
    private readonly issuer: string,
    private readonly audience: string[],
    private readonly ttl: number,
    keyFile?: string,
    kid = "driver-local",
  ) {
    this.kid = keyFile ? kid : kid + "-" + randomUUID();
    const keys = keyFile
      ? null
      : generateKeyPairSync("rsa", { modulusLength: 2048 });
    this.privateKey = keyFile
      ? readFileSync(keyFile, "utf8")
      : keys!.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const key = createPublicKey(this.privateKey);
    this.publicKey = key.export({ type: "spki", format: "pem" }).toString();
    this.jwks = {
      keys: [
        {
          ...key.export({ format: "jwk" }),
          kid: this.kid,
          alg: "RS256",
          use: "sig",
        },
      ],
    };
  }
  issue(driver: Driver) {
    return this.jwt.sign(
      { sub: driver.id, role: "DRIVER" },
      {
        privateKey: this.privateKey,
        algorithm: "RS256",
        issuer: this.issuer,
        audience: this.audience,
        expiresIn: this.ttl,
        keyid: this.kid,
      },
    );
  }
  async verify(header: string | undefined): Promise<Principal> {
    if (!header || header.length > 8192 || !/^Bearer [^\s]+$/.test(header))
      throw new DriverError("UNAUTHENTICATED");
    try {
      const claims = this.jwt.verify<{
        sub: string;
        role: string;
        exp: number;
        iat: number;
      }>(header.slice(7), {
        publicKey: this.publicKey,
        algorithms: ["RS256"],
        issuer: this.issuer,
        audience: "driver-service",
      });
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          claims.sub,
        ) ||
        claims.role !== "DRIVER" ||
        !Number.isInteger(claims.exp) ||
        !Number.isInteger(claims.iat)
      )
        throw new Error("claims");
      return { sub: claims.sub.toLowerCase(), role: "DRIVER" };
    } catch {
      throw new DriverError("UNAUTHENTICATED");
    }
  }
}
