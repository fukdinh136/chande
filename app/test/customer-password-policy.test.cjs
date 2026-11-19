const {test} = require('node:test'), assert = require('node:assert/strict');
const {loader} = require('./helpers/driver.cjs');
test('registration and password change enforce the same BCrypt 72-byte boundary without rejecting legacy login inputs', () => {
  const load = loader(), {validateAuth} = load('src/features/customer/auth-form.ts'), {validatePassword} = load('src/features/customer/account-form.ts');
  for (const password of ['á'.repeat(35) + 'A1', '😀'.repeat(17) + 'Ab12', 'A1' + 'a'.repeat(70)]) {
    assert.equal(validateAuth({phoneNumber: '0912345678', fullName: 'Khách', password}, true).password, undefined);
    assert.equal(validatePassword('OldPass123', password, password).newPassword, undefined);
    const tooLong = password + 'a'; assert.ok(validateAuth({phoneNumber: '0912345678', fullName: 'Khách', password: tooLong}, true).password); assert.ok(validatePassword('OldPass123', tooLong, tooLong).newPassword);
  }
  assert.equal(validateAuth({phoneNumber: '0912345678', fullName: '', password: 'á'.repeat(35) + 'Ab1'}, false).password, undefined);
});
