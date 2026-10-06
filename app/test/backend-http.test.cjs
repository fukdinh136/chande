const {test}=require('node:test'),assert=require('node:assert/strict'),{load}=require('../scripts/test-client.cjs');
const {BackendHttp,origin}=load('src/features/backend/http.ts'),{discover,candidates}=load('src/features/backend/discovery.ts');
const requestId='11111111-1111-4111-8111-111111111111';

test('browser fetch is called without binding the HTTP client as its receiver',async()=>{
  const http=new BackendHttp('http://localhost:18081',async function(){
    'use strict';assert.equal(this,undefined);
    return new Response(JSON.stringify({accessToken:'demo-token'}),{status:200});
  });
  assert.deepEqual((await http.send({service:'user',path:'/auth/login',method:'POST',body:{}})).data,{accessToken:'demo-token'});
});
test('raw User/204, Node envelope/replay and error fields keep different wire contracts',async()=>{
  let body={accessToken:'token'},status=200;
  const http=new BackendHttp('http://localhost:18080',async()=>new Response(status===204?null:JSON.stringify(body),{status,headers:{'Idempotent-Replay':'true'}}));
  assert.deepEqual((await http.send({service:'user',path:'/auth/login',method:'POST',body:{}})).data,body);
  status=204;assert.equal((await http.send({service:'user',path:'/auth/logout',method:'POST'})).data,null);
  status=200;body={data:null,meta:{requestId}};assert.equal((await http.send({service:'trip',path:'/trips/active'})).replayed,true);
  status=400;body={code:'VALIDATION_ERROR',fieldErrors:{phoneNumber:'required'}};await assert.rejects(http.send({service:'user',path:'/auth/login'}),e=>e.code==='VALIDATION_ERROR'&&e.fields.phoneNumber==='required');
});
test('discovery respects explicit origin, auth envelope, and never enables HTTP/autodiscovery release',async()=>{
  assert.throws(()=>candidates({development:false,platform:'android'}));assert.throws(()=>origin('http://localhost:18080',false));
  assert.throws(()=>origin('https://user:password@example.org',false));assert.throws(()=>origin('https://example.org/api/v1',false));
  const seen=[];const base=await discover({development:true,platform:'web'},async url=>{seen.push(url);return new Response(JSON.stringify(url.includes('18080')?{status:'ok'}:{error:{code:'UNAUTHENTICATED'},meta:{requestId}}),{status:url.includes('18080')?200:401})});
  assert.equal(base,'http://127.0.0.1:18081');assert.equal(seen.length,2);
});
test('only public paths and controlled headers are sent; cancel is distinguished from timeout',async()=>{
  const seen=[];const http=new BackendHttp('http://localhost:18080',async(url,options)=>{seen.push({url,options});return new Response(JSON.stringify({data:{},meta:{requestId}}),{status:200})});
  await assert.rejects(http.send({service:'matching',path:'/internal/matching/requests'}));
  await http.send({service:'matching',path:'/matching/offers/active',token:'driver-jwt',key:requestId});assert.equal(seen[0].options.headers['X-Service-Token'],undefined);assert.equal(seen[0].options.headers.Authorization,'Bearer driver-jwt');
  const timeout=new BackendHttp('http://localhost:18080',(_,o)=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(new Error('abort')))),5);await assert.rejects(timeout.send({service:'trip',path:'/trips/active'}),e=>e.code==='TIMEOUT');
});
