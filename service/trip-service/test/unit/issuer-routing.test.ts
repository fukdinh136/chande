import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoleIdentity } from '../../src/api/auth';
import { DomainError } from '../../src/domain/error';
test('configured issuer chooses trusted role verifier without contacting unrelated JWKS', async () => {
  const driver = { sub: '11111111-1111-4111-8111-111111111111', role: 'DRIVER' as const };
  let riderCalled = false;
  const identity = new RoleIdentity({ verify: async () => { riderCalled = true; throw new DomainError('DEPENDENCY_UNAVAILABLE'); } }, { verify: async () => driver }, 'rider-issuer', 'driver-issuer');
  const header = (issuer: string) => 'Bearer ' + Buffer.from('{}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ iss: issuer })).toString('base64url') + '.signature';
  assert.deepEqual(await identity.verify(header('driver-issuer')), driver); assert.equal(riderCalled, false);
  await assert.rejects(identity.verify(header('unknown')), /UNAUTHENTICATED/);
});
