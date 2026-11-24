const fs = require('node:fs'), path = require('node:path'), {spawnSync, spawn} = require('node:child_process');
const {root, images} = require('./stack.cjs');
const observability = require('./observability.cjs');
const {ensurePortForward} = require('./port-forward.cjs');
const action = process.argv[2], directory = path.join(__dirname,'.local','backend');
const command = (bin,args,cwd=root,quiet=false) => {
  const r = spawnSync(bin,args,{cwd,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});
  if (!quiet && r.stdout) process.stdout.write(r.stdout);
  if (r.status!==0) { if(r.stderr)process.stderr.write(r.stderr); throw new Error(`${bin} failed (status ${r.status})`); }
  return r.stdout;
};
const kube = args => command('kubectl',['--context','docker-desktop','--namespace','chande-local',...args]);
function generate() { delete require.cache[require.resolve('./generate.cjs')]; return require('./generate.cjs'); }
if (!['generate','build','docker-up','kube-up','kube-forward','status'].includes(action)) throw new Error('Usage: node deploy/run.cjs generate|build|docker-up|kube-up|kube-forward|status');
const {apps} = action==='kube-forward' ? {} : generate();
if(action==='build') {
  const ids={};
  for(const [service,a] of new Map(Object.values(apps).map(a=>[a.service,a]))) {
    const folder=service==='gateway'?'api-gateway':service+'-service', cwd=path.join(root,'service',folder);
    if(a.java) {
      console.info(`Package Java ${folder}`);
      const bin=process.platform==='win32'?'cmd.exe':'./mvnw', args=process.platform==='win32'?['/d','/s','/c','mvnw.cmd -B -DskipTests package']:['-B','-DskipTests','package'];
      const r=spawnSync(bin,args,{cwd,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});
      fs.writeFileSync(path.join(directory,'build-'+service+'.log'),(r.stdout??'')+(r.stderr??''));
      if(r.status!==0)throw new Error('Java package failed; see private build log for '+folder);
    }
    console.info('Build '+a.image);
    const args=['build','-t',a.image,...(a.java?['--target','runtime-prebuilt']:[]),cwd];
    const r=spawnSync('docker',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});
    fs.writeFileSync(path.join(directory,'build-'+service+'-docker.log'),(r.stdout??'')+(r.stderr??''));
    if(r.status!==0) { console.error((r.stderr??'').split('\n').slice(-20).join('\n')); throw new Error('Docker build failed: '+service); }
    ids[a.image]=command('docker',['image','inspect','--format','{{.Id}}',a.image],root,true).trim();
  }
  fs.writeFileSync(path.join(directory,'images.json'),JSON.stringify(ids,null,2)); generate();
  console.info('Eight backend images built.');
}
if(action==='docker-up') {
  command('docker',['compose','-f',path.join(directory,'compose.json'),'config','--quiet']);
  command('docker',['compose','-f',path.join(directory,'compose.json'),'up','-d','--wait','--wait-timeout','300']);
  console.info('Docker backend: http://127.0.0.1:18080');
}
if(action==='kube-up') {
  command('kubectl',['--context','docker-desktop','get','node','docker-desktop']);
  const namespace=spawnSync('kubectl',['--context','docker-desktop','get','namespace','chande-local','-o','json'],{encoding:'utf8',windowsHide:true});
  if(namespace.status===0 && JSON.parse(namespace.stdout).metadata.labels?.['app.kubernetes.io/part-of']!=='chande') throw new Error('Refusing to deploy over namespace not owned by this stack');
  kube(['apply','-f',path.join(directory,'infra.json')]);
  // apply keeps keys removed from stringData; replace makes each service env Secret match the generated file.
  kube(['replace','-f',path.join(directory,'env-secrets.json')]);
  for(const name of ['postgres','redis','rabbitmq','osrm']) kube(['rollout','status','deployment/'+name,'--timeout=300s']);
  for(const name of ['trip-migrate','matching-migrate']) {
    const existing=spawnSync('kubectl',['--context','docker-desktop','-n','chande-local','get','job',name,'-o','json'],{encoding:'utf8',windowsHide:true});
    if(existing.status===0) {
      const job=JSON.parse(existing.stdout);
      if(job.metadata.labels?.['app.kubernetes.io/part-of']!=='chande'||job.status?.active) throw new Error('Refusing to replace unknown/active migration job '+name);
      kube(['delete','job',name]);
    }
  }
  kube(['apply','-f',path.join(directory,'migrations.json')]);
  kube(['wait','--for=condition=complete','job/trip-migrate','job/matching-migrate','--timeout=240s']);
  // Observability goes up before the services so their first export finds the Collector; with the flag off it is removed.
  if(observability.enabled()) { kube(['apply','-f',path.join(directory,'observability.json')]); for(const name of ['otel-collector','jaeger','prometheus','grafana']) kube(['rollout','status','deployment/'+name,'--timeout=300s']); }
  else kube(['delete','deployment,service,configmap,secret','-l','app.kubernetes.io/component=observability','--ignore-not-found']);
  kube(['apply','-f',path.join(directory,'workloads.json')]);
  for(const name of [...Object.keys(apps),'edge']) kube(['rollout','status','deployment/'+name,'--timeout=300s']);
  // The edge forward is supervised by port-forward.cjs (below); observability ports keep a plain forward each.
  if(observability.enabled()) {
    const forward=(pidName,target,mapping)=>{
      const pidFile=path.join(directory,pidName+'.pid');
      if(fs.existsSync(pidFile)) return;
      const output=fs.openSync(path.join(directory,pidName+'.log'),'a');
      const child=spawn('kubectl',['--context','docker-desktop','-n','chande-local','port-forward','--address','127.0.0.1',target,mapping],{detached:true,windowsHide:true,stdio:['ignore',output,output]});
      fs.writeFileSync(pidFile,String(child.pid)); child.unref(); fs.closeSync(output);
    };
    for(const [name,[local,remote]] of Object.entries(observability.ports)) forward('port-forward-'+name,'service/'+name,`${local}:${remote}`);
    console.info(`Observability: Grafana http://127.0.0.1:${observability.ports.grafana[0]}  Jaeger http://127.0.0.1:${observability.ports.jaeger[0]}  Prometheus http://127.0.0.1:${observability.ports.prometheus[0]}`);
  }
}
if(action==='kube-up'||action==='kube-forward') ensurePortForward().then(()=>{
  console.info('Kubernetes backend ready: http://127.0.0.1:18081 (loopback port-forward)');
}).catch(error=>{console.error(error.message);process.exitCode=1});
if(action==='status') {
  command('docker',['compose','-f',path.join(directory,'compose.json'),'ps']);
  kube(['get','pods,services,pvc,jobs']);
}
