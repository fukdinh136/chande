const fs = require('node:fs'), path = require('node:path'), {spawnSync, spawn} = require('node:child_process');
const {root, images} = require('./stack.cjs');
const action = process.argv[2], directory = path.join(__dirname,'.local','backend');
const command = (bin,args,cwd=root,quiet=false) => {
  const r = spawnSync(bin,args,{cwd,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});
  if (!quiet && r.stdout) process.stdout.write(r.stdout);
  if (r.status!==0) { if(r.stderr)process.stderr.write(r.stderr); throw new Error(`${bin} failed (status ${r.status})`); }
  return r.stdout;
};
const kube = args => command('kubectl',['--context','docker-desktop','--namespace','chande-local',...args]);
function generate() { delete require.cache[require.resolve('./generate.cjs')]; return require('./generate.cjs'); }
if (!['generate','build','docker-up','kube-up','status'].includes(action)) throw new Error('Usage: node deploy/run.cjs generate|build|docker-up|kube-up|status');
const {apps} = generate();
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
  kube(['apply','-f',path.join(directory,'workloads.json')]);
  for(const name of [...Object.keys(apps),'edge']) kube(['rollout','status','deployment/'+name,'--timeout=300s']);
  const pidFile=path.join(directory,'port-forward.pid');
  if(!fs.existsSync(pidFile)) {
    const output=fs.openSync(path.join(directory,'port-forward.log'),'a');
    const child=spawn('kubectl',['--context','docker-desktop','-n','chande-local','port-forward','--address','127.0.0.1','service/edge','18081:8088'],{detached:true,windowsHide:true,stdio:['ignore',output,output]});
    fs.writeFileSync(pidFile,String(child.pid)); child.unref(); fs.closeSync(output);
  }
  console.info('Kubernetes backend: http://127.0.0.1:18081 (loopback port-forward)');
}
if(action==='status') {
  command('docker',['compose','-f',path.join(directory,'compose.json'),'ps']);
  kube(['get','pods,services,pvc,jobs']);
}
