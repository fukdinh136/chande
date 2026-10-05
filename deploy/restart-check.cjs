const assert=require('node:assert/strict'),{randomInt}=require('node:crypto'),{spawnSync}=require('node:child_process');
const base='http://127.0.0.1:18081';
async function request(path,body,token,status=200){const r=await fetch(base+'/api/v1'+path,{method:body===undefined?'GET':'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();assert.equal(r.status,status,path+': '+(data.error?.code??data.code));return data.data??data}
function kube(args){const r=spawnSync('kubectl',['--context','docker-desktop','-n','chande-local',...args],{encoding:'utf8',windowsHide:true});if(r.stdout)process.stdout.write(r.stdout);if(r.status!==0)throw new Error('Kubernetes restart check failed')}
(async()=>{
  const phoneNumber='+849'+String(randomInt(100000000)).padStart(8,'0'),password='BackendRestart123!';
  const registered=await request('/auth/register',{phoneNumber,password,fullName:'Restart Verification'},undefined,201),rider=await request('/auth/login',{phoneNumber,password});
  const phone='84900000004',challenge=await request('/driver-auth/otp/request',{phoneNumber:phone}),driver=await request('/driver-auth/otp/verify',{phoneNumber:phone,challengeId:challenge.challengeId,otp:'123456'});
  const names=['user-api','gateway-api','driver-api','realtime-api','matching-worker'];
  kube(['rollout','restart',...names.map(n=>'deployment/'+n)]);
  for(const name of names)kube(['rollout','status','deployment/'+name,'--timeout=300s']);
  assert.equal((await request('/users/me',undefined,rider.accessToken)).id,registered.id);
  assert.equal((await request('/drivers/me',undefined,driver.accessToken)).driverId,'10000000-0000-4000-8000-000000000004');
  console.info('Restart check pass: persisted User record and pre-restart RIDER/DRIVER JWT remain valid; five deployments Ready.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
