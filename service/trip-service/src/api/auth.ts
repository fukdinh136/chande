import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../bootstrap/config';
import type { Principal } from '../domain/models';
import { DomainError } from '../domain/error';
export interface IdentityVerifier { verify(header: string | undefined): Promise<Principal> }
async function remoteKeys(url: string, timeout: number) { const jose = await import('jose'); return jose.createRemoteJWKSet(new URL(url), { timeoutDuration: timeout }); }
export class JwtVerifier implements IdentityVerifier {
  private resolver?: Awaited<ReturnType<typeof remoteKeys>>;
  constructor(private readonly config: Pick<Config, 'jwksUrl' | 'issuer' | 'audience' | 'httpTimeout'>) {}
  async verify(header: string | undefined): Promise<Principal> {
    if (!header || header.length > 8192 || !/^Bearer [^\s]+$/.test(header)) throw new DomainError('UNAUTHENTICATED');
    try {
      const jose = await import('jose');
      this.resolver ??= await remoteKeys(this.config.jwksUrl, this.config.httpTimeout);
      const { payload } = await jose.jwtVerify(header.slice(7), this.resolver, { issuer: this.config.issuer, audience: this.config.audience, algorithms: ['RS256', 'ES256'], requiredClaims: ['exp', 'sub', 'role'] });
      const result = z.object({ sub: z.uuid(), role: z.enum(['RIDER', 'DRIVER']) }).safeParse(payload);
      if (!result.success) throw new DomainError('UNAUTHENTICATED');
      return { ...result.data, sub: result.data.sub.toLowerCase() };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      const code = (error as { code?: string }).code;
      if (code === 'ERR_JWKS_TIMEOUT' || error instanceof TypeError) throw new DomainError('DEPENDENCY_UNAVAILABLE');
      throw new DomainError('UNAUTHENTICATED');
    }
  }
}
/** Trusted issuers are configured independently; role is restricted per issuer. */
export class RoleIdentity implements IdentityVerifier {
  constructor(private readonly rider: IdentityVerifier, private readonly driver: IdentityVerifier, private readonly riderIssuer?: string, private readonly driverIssuer?: string) {}
  async verify(header: string | undefined): Promise<Principal> {
    if (this.riderIssuer && this.driverIssuer) {
      if (!header || !/^Bearer [^\s]+$/.test(header)) throw new DomainError('UNAUTHENTICATED');
      let issuer: unknown; try { const jose = await import('jose'); issuer = jose.decodeJwt(header.slice(7)).iss; } catch { throw new DomainError('UNAUTHENTICATED'); }
      // Unverified issuer selects a trusted verifier only; signatures/claims still must verify.
      const role = issuer === this.driverIssuer ? 'DRIVER' : issuer === this.riderIssuer ? 'RIDER' : null;
      if (!role) throw new DomainError('UNAUTHENTICATED');
      const principal = await (role === 'DRIVER' ? this.driver : this.rider).verify(header);
      if (principal.role !== role) throw new DomainError('UNAUTHENTICATED'); return principal;
    }
    try { const p = await this.rider.verify(header); if (p.role === 'RIDER') return p; } catch (error) { if (error instanceof DomainError && error.code === 'DEPENDENCY_UNAVAILABLE') throw error; }
    const p = await this.driver.verify(header); if (p.role !== 'DRIVER') throw new DomainError('UNAUTHENTICATED'); return p;
  }
}
export function verifyServiceCredential(value: string | undefined, expected: string): void {
  const actual = Buffer.from(value ?? ''); const secret = Buffer.from(expected);
  if (!secret.length || actual.length !== secret.length || !timingSafeEqual(actual, secret)) throw new DomainError('INVALID_SERVICE_CREDENTIAL');
}
