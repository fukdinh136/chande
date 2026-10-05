import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Identity } from '../src/api/auth';
test('driver JWT enforces issuer/audience/role and expiry independently', async () => {
  const jose = await import('jose'), keys = await jose.generateKeyPair('RS256'), jwk = await jose.exportJWK(keys.publicKey); jwk.kid = 'test';
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); }); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try { const identity = new Identity({ jwksUrl: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`, issuer: 'test-driver', audience: 'matching-service' });
    const token = (role = 'DRIVER', audience = 'matching-service', expiry = '1m') => new jose.SignJWT({ role }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject('11111111-1111-4111-8111-111111111111').setIssuer('test-driver').setAudience(audience).setIssuedAt().setExpirationTime(expiry).sign(keys.privateKey);
    assert.equal(await identity.verify('Bearer ' + await token()), '11111111-1111-4111-8111-111111111111');
    await assert.rejects(identity.verify('Bearer ' + await token('RIDER')), /FORBIDDEN/); await assert.rejects(identity.verify('Bearer ' + await token('DRIVER', 'trip-service')), /UNAUTHENTICATED/); await assert.rejects(identity.verify('Bearer ' + await token('DRIVER', 'matching-service', '-1s')), /UNAUTHENTICATED/);
  } finally { await new Promise<void>(r => server.close(() => r())); }
});
