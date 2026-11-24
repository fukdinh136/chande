const {test}=require('node:test'),assert=require('node:assert/strict'),{load}=require('../scripts/test-client.cjs');
const {loginMessage}=load('src/features/customer/login-messages.ts');
const {BackendError}=load('src/features/backend/http.ts');
test('login errors become Vietnamese messages; a busy user service asks the rider to wait',()=>{
  assert.equal(loginMessage(new BackendError('SERVICE_BUSY',503,undefined,1)),'Hệ thống đang bận, hãy thử lại sau 1 giây.');
  assert.equal(loginMessage(new BackendError('SERVICE_BUSY',503)),'Hệ thống đang bận, hãy thử lại sau 1 giây.');
  assert.equal(loginMessage(new BackendError('INVALID_CREDENTIALS',401)),'Số điện thoại hoặc mật khẩu không đúng.');
  assert.equal(loginMessage(new BackendError('SOMETHING_NEW',500)),'Không thể đăng nhập (SOMETHING_NEW).');
  assert.equal(loginMessage(new Error('x')),'Không thể đăng nhập.');
});
