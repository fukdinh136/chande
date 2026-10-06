const {test}=require('node:test'),assert=require('node:assert/strict'),{load}=require('../scripts/test-client.cjs');
const {UserSession}=load('src/features/backend/user-session.ts');
test('customer single-flight refresh and logout never restore token; newest rotation is revoked',async()=>{
  let saved=null,rotations=0,release;const loggedOut=[];
  const tokens={accessToken:'old',refreshToken:'refresh-old',expiresIn:1,tokenType:'Bearer'};
  const api={login:async()=>tokens,profile:async()=>({id:'user'}),refresh:async()=>{rotations++;await new Promise(r=>release=r);return {...tokens,accessToken:'new',refreshToken:'refresh-new',expiresIn:900}},logout:async t=>loggedOut.push(t)};
  const session=new UserSession(api,{read:async()=>saved,write:async v=>{saved=v}});await session.login('phone','password');
  const a=session.token(),b=session.token();await new Promise(r=>setImmediate(r));assert.equal(rotations,1);
  const logout=session.logout();release();await Promise.allSettled([a,b]);await logout;
  assert.equal(session.getSnapshot().session,null);assert.equal(saved,null);assert.deepEqual(loggedOut,['refresh-new']);
});
