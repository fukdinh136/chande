import { timingSafeEqual } from 'node:crypto';
import { uuid, MatchingError } from '../domain/models';
import type { Config } from '../bootstrap/config';
export function credential(actual: string | undefined, expected: string) { const a = Buffer.from(actual ?? ''), b = Buffer.from(expected); if (!b.length || a.length !== b.length || !timingSafeEqual(a, b)) throw new MatchingError('UNAUTHENTICATED', 401); }
async function remote(url: string) { const jose = await import('jose'); return jose.createRemoteJWKSet(new URL(url), { timeoutDuration: 3000 }); }
export class Identity {
  private resolver?: Awaited<ReturnType<typeof remote>>;
  constructor(private readonly config: Pick<Config, 'jwksUrl' | 'issuer' | 'audience'>) {}
  async verify(header: string | undefined) {
    if (!header || header.length > 8192 || !/^Bearer [^\s]+$/.test(header)) throw new MatchingError('UNAUTHENTICATED', 401);
    try {
      const jose = await import('jose'); this.resolver ??= await remote(this.config.jwksUrl);
      const { payload } = await jose.jwtVerify(header.slice(7), this.resolver, { issuer: this.config.issuer, audience: this.config.audience, algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat', 'role'] });
      if (payload.role !== 'DRIVER') throw new MatchingError('FORBIDDEN', 403);
      const sub = uuid.safeParse(payload.sub); if (!sub.success) throw new MatchingError('UNAUTHENTICATED', 401); return sub.data;
    } catch (error) { if (error instanceof MatchingError) throw error; throw new MatchingError('UNAUTHENTICATED', 401); }
  }
}
