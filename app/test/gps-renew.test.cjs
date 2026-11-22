const {test}=require('node:test'),assert=require('node:assert/strict'),{load}=require('../scripts/test-client.cjs');
const {tokenExpiry,renewDelay,reconnectDelay}=load('src/features/driver/gps/socket-location-client.ts');
// B5: the GPS socket renews its JWT 1 to 3 minutes before expiry, at a random point, and reconnects within 2 to 10 s.
test('renewal time is spread before the JWT expires and reads exp from the token',()=>{
  const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const token=`${encode({alg:'RS256'})}.${encode({sub:'d',exp:1700000900})}.sig`;
  assert.equal(tokenExpiry(token),1700000900000);assert.equal(tokenExpiry('broken'),null);assert.equal(tokenExpiry('a.!!!.b'),null);
  const now=1700000000000,exp=now+15*60000;
  assert.equal(renewDelay(exp,now,()=>0),14*60000);assert.equal(renewDelay(exp,now,()=>0.999999),12*60000+1);
  assert.equal(renewDelay(now+30000,now,()=>0.5),5000,'never sooner than 5 s');
  assert.equal(reconnectDelay(()=>0),2000);assert.equal(reconnectDelay(()=>0.999999),9999);
});
