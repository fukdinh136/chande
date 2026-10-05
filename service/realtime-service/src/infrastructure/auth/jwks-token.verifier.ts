import { TokenVerifier, DriverIdentity } from '../../application/ports/token-verifier.port';
import { RealtimeError } from '../../domain/errors';
export class JwksTokenVerifier implements TokenVerifier {
  private readonly verifier;
  constructor(jwksUrl: string, issuer: string, audience: string, timeoutMs: number) {
    // Native dynamic import preserves compatibility with jose's ESM package on Node 24.
    this.verifier = import('jose').then(({ createRemoteJWKSet, jwtVerify }) => {
      const keys = createRemoteJWKSet(new URL(jwksUrl), { timeoutDuration: timeoutMs, cooldownDuration: 5000 });
      return (token: string) => jwtVerify(token, keys, { issuer, audience, algorithms: ['RS256'], requiredClaims: ['sub', 'role', 'exp', 'iat'] });
    });
  }
  async verify(token: string): Promise<DriverIdentity> {
    if (typeof token !== 'string' || token.length > 8192 || !token || /\s/.test(token)) throw new RealtimeError('UNAUTHENTICATED');
    try {
      const { payload } = await (await this.verifier)(token);
      if (typeof payload.sub !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.sub) ||
          payload.role !== 'DRIVER' || !Number.isInteger(payload.exp) || !Number.isInteger(payload.iat) || payload.iat! > Date.now() / 1000 + 5)
        throw new RealtimeError('UNAUTHENTICATED');
      return { driverId: payload.sub.toLowerCase(), expiresAt: payload.exp! * 1000 };
    } catch (error) {
      if (error instanceof RealtimeError) throw error;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      if (code === 'ERR_JWKS_TIMEOUT' || error instanceof TypeError) throw new RealtimeError('DEPENDENCY_UNAVAILABLE');
      throw new RealtimeError('UNAUTHENTICATED');
    }
  }
}
