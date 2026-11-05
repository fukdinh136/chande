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
  // rollout status can report the previous generation as done if it runs before the controller sees the restart.
  for(const name of names){const generation=()=>{const r=spawnSync('kubectl',['--context','docker-desktop','-n','chande-local','get','deployment/'+name,'-o','jsonpath={.metadata.generation} {.status.observedGeneration}'],{encoding:'utf8',windowsHide:true});const [want,seen]=r.stdout.trim().split(' ').map(Number);return seen>=want};const end=Date.now()+60000;while(!generation()){if(Date.now()>end)throw new Error('Kubernetes restart check failed');spawnSync('sleep',['1'])}}
  for(const name of names)kube(['rollout','status','deployment/'+name,'--timeout=300s']);
  // Recreate leaves the Service without endpoints until the new pod is ready and kube-proxy catches up (edge answers 502).
  const end=Date.now()+60000;for(const token of [rider.accessToken,driver.accessToken])while([502,503,504].includes((await fetch(base+'/api/v1/users/me',{signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token}})).status)){if(Date.now()>end)throw new Error('Gateway not reachable after restart');await new Promise(r=>setTimeout(r,500))}
  assert.equal((await request('/users/me',undefined,rider.accessToken)).id,registered.id);
  assert.equal((await request('/drivers/me',undefined,driver.accessToken)).driverId,'10000000-0000-4000-8000-000000000004');
  console.info('Restart check pass: persisted User record and pre-restart RIDER/DRIVER JWT remain valid; five deployments Ready.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
