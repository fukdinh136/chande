const {test} = require('node:test'), assert = require('node:assert/strict');
const {load} = require('../scripts/test-client.cjs');
const {validateAuth, authFailure} = load('src/features/customer/auth-form.ts');
const {BackendError} = load('src/features/backend/http.ts');

test('Customer auth validation follows VN phone normalization and distinct login/register password rules', () => {
  const valid = {phoneNumber: '091 234 5678', password: 'pass1234', fullName: 'Khách hàng'};
  for (const phoneNumber of ['0912345678', '+84912345678', '84912345678', '091.234.5678', '0387654321']) assert.deepEqual(validateAuth({...valid, phoneNumber}, true), {});
  for (const phoneNumber of ['0123456789', '091234567', '09123456789', 'abc']) assert.ok(validateAuth({...valid, phoneNumber}, false).phoneNumber);
  assert.deepEqual(validateAuth({...valid, password: 'x'}, false), {});
  assert.ok(validateAuth({...valid, password: 'x'}, true).password);
  assert.ok(validateAuth({...valid, password: 'x'.repeat(73)}, false).password);
  assert.ok(validateAuth({...valid, fullName: ' '}, true).fullName);
  assert.ok(validateAuth({...valid, fullName: 'x'.repeat(101)}, true).fullName);
});

test('Customer auth errors map known fields and hide unknown codes/server internals', () => {
  assert.ok(authFailure(new BackendError('PHONE_ALREADY_EXISTS', 409)).fields.phoneNumber);
  const error = authFailure(new BackendError('VALIDATION_ERROR', 400, undefined, undefined, {password: 'STACK_TRACE', fullName: 'SQL_FAILURE', unknown: 'INTERNAL_HOST'}));
  assert.ok(error.fields.password); assert.ok(error.fields.fullName); assert.equal(error.fields.unknown, undefined);
  assert.doesNotMatch(JSON.stringify(error), /STACK_TRACE|SQL_FAILURE|INTERNAL_HOST/);
  assert.doesNotMatch(authFailure(new BackendError('PRIVATE_INTERNAL_ERROR', 500)).message, /PRIVATE_INTERNAL_ERROR/);
});
