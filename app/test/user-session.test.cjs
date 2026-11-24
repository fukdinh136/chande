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

test('customer restore keeps stored refresh contract, loads profile and rotates once',async()=>{
  const rotations=[],tokens={accessToken:'fresh-access',refreshToken:'fresh-refresh',expiresIn:900,tokenType:'Bearer'};let saved='stored-refresh';
  const session=new UserSession({refresh:async token=>{rotations.push(token);return tokens},profile:async()=>({id:'customer-b'}),logout:async()=>{}},{read:async()=>saved,write:async value=>{saved=value}});
  await session.restore();assert.deepEqual(rotations,['stored-refresh']);assert.equal(saved,'fresh-refresh');assert.equal(session.getSnapshot().session.profile.id,'customer-b');assert.equal(session.getSnapshot().restoring,false);
});

test('customer authorized never dispatches an old action with a new owner token after refresh',async()=>{
  let release,actor='a',calls=0;const tokens={accessToken:'old',refreshToken:'r',expiresIn:1,tokenType:'Bearer'};
  const api={login:async()=>({...tokens,...(actor==='b'?{accessToken:'b-token',expiresIn:900}:{})}),profile:async()=>({id:actor}),refresh:()=>new Promise(resolve=>{release=resolve}),logout:async()=>{}};
  const session=new UserSession(api,{read:async()=>null,write:async()=>{}});await session.login('','');
  const action=session.authorized(async()=>{calls++;});await new Promise(resolve=>setImmediate(resolve));
  const logout=session.logout();actor='b';await session.login('','');release({...tokens,accessToken:'old-rotated',refreshToken:'rotated-r',expiresIn:900});
  await assert.rejects(action,error=>error.code==='CANCELLED');await logout;assert.equal(calls,0);assert.equal(session.getSnapshot().session.profile.id,'b');
});
