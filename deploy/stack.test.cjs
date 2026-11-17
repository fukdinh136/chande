const {test}=require('node:test'),assert=require('node:assert/strict');
const {stack}=require('./stack.cjs');
const secrets=new Proxy({},{get:(_,key)=>'test-'+String(key).padEnd(64,'x')});
test('real issuer and callback topology keeps credentials scoped and public ports separate',()=>{
  const apps=stack(secrets);
  assert.equal(apps['trip-api'].env.AUTH_JWKS_URL,'http://user-api:3011/.well-known/jwks.json');
  assert.equal(apps['trip-worker'].env.GATEWAY_EVENTS_BASE_URL,'http://gateway-api:8090');
  // B2: trip events reach the Gateway once; there is no second destination pointing at it.
  assert.ok(!Object.keys(apps['trip-worker'].env).some(k=>k.startsWith('NOTIFICATION_')));
  assert.equal(apps['trip-api'].env.DRIVER_AUTH_JWT_ISSUER,apps['driver-api'].env.AUTH_JWT_ISSUER);
  assert.equal(apps['trip-api'].env.MATCHING_CALLBACK_TOKEN,apps['matching-api'].env.TRIP_MATCHING_TOKEN);
  assert.equal(apps['gateway-api'].env.ROUTING_GATEWAY_TOKEN,apps['routing-api'].env.ROUTING_GATEWAY_TOKEN);
  assert.notEqual(apps['routing-api'].env.ROUTING_GATEWAY_TOKEN,apps['routing-api'].env.ROUTING_MATCHING_TOKEN);
  assert.equal(new Set(Object.values(apps).map(a=>a.port)).size,Object.keys(apps).length);
  assert.equal(apps['matching-api'].env.MATCHING_REALTIME_TOKEN,apps['realtime-api'].env.MATCHING_REALTIME_TOKEN);
  // ADR-0001: Matching reads raw locations from Realtime with its own credential.
  assert.equal(apps['matching-worker'].env.REALTIME_MATCHING_TOKEN,apps['realtime-api'].env.MATCHING_LOCATION_TOKEN);
  assert.notEqual(apps['realtime-api'].env.MATCHING_LOCATION_TOKEN,apps['realtime-api'].env.MATCHING_REALTIME_TOKEN);
  // ADR-0001 contract: Routing no longer calls Realtime, Realtime no longer calls Driver.
  assert.ok(!Object.keys(apps['routing-api'].env).some(k=>k.startsWith('REALTIME_')));
  assert.ok(!Object.keys(apps['realtime-api'].env).some(k=>k.startsWith('DRIVER_')));
});
test('edge nginx is sized from the drivers online at peak',()=>{
  const {edgeSizing}=require('./stack.cjs');
  assert.deepEqual(edgeSizing(5000),{peakDrivers:5000,workerConnections:12500,rlimitNofile:25000,memory:'448Mi'});
  assert.equal(edgeSizing(100).workerConnections,1024);
  assert.throws(()=>edgeSizing(50),/EDGE_PEAK_DRIVERS/);
  const conf=require('node:fs').readFileSync(require('node:path').join(__dirname,'nginx.conf'),'utf8');
  assert.match(conf,/__WORKER_CONNECTIONS__/); assert.match(conf,/__RLIMIT_NOFILE__/);
  assert.match(conf,/proxy_set_header X-Forwarded-For \$remote_addr;/);
  // REST to the Gateway goes through a keepalive pool; without it the edge ran out of local ports at 5000 drivers + 5000 riders.
  assert.match(conf,/upstream gateway_rest \{[^}]*keepalive \d+;/); assert.match(conf,/location \/api\/v1\/ \{\s*proxy_pass http:\/\/gateway_rest;/);
});
const fs=require('node:fs'),path=require('node:path');
const observability=require('./observability.cjs');
const nodeServices=['trip','matching','driver','realtime','price','routing'];
test('observability is off by default and switches on the Node services and the Gateway',()=>{
  const off=stack(secrets,{observability:false}),on=stack(secrets,{observability:true});
  assert.ok(!Object.values(off).some(a=>Object.keys(a.env).some(k=>k.startsWith('OTEL_'))));
  for(const [name,a] of Object.entries(on)) {
    const telemetry=Object.fromEntries(Object.entries(a.env).filter(([k])=>k.startsWith('OTEL_')));
    if(name==='user-api') assert.deepEqual(telemetry,{},name);
    else { assert.equal(telemetry.OTEL_SERVICE_NAME,name); assert.equal(telemetry.OTEL_EXPORTER_OTLP_ENDPOINT,'http://otel-collector:4318'); assert.equal(telemetry.OTEL_TRACES_SAMPLER,'parentbased_traceidratio'); }
    // Nothing else changes when the flag is on.
    // The Gateway also gets the Java agent flag next to the image's own JVM flags.
    if(name==='gateway-api') { assert.equal(telemetry.OTEL_LOGS_EXPORTER,'none'); assert.match(a.env.JAVA_TOOL_OPTIONS,/^-XX:MaxRAMPercentage=70 -XX:ActiveProcessorCount=2 -javaagent:\/app\/opentelemetry-javaagent\.jar$/); }
    assert.deepEqual(Object.fromEntries(Object.entries(a.env).filter(([k])=>!k.startsWith('OTEL_')&&k!=='JAVA_TOOL_OPTIONS')),off[name].env,name);
  }
});
test('every Node entry point loads the same telemetry bootstrap first',()=>{
  const file=service=>path.join(__dirname,'..','service',service+'-service','src');
  const master=fs.readFileSync(path.join(file('matching'),'bootstrap','telemetry.ts'),'utf8');
  for(const service of nodeServices) {
    assert.equal(fs.readFileSync(path.join(file(service),'bootstrap','telemetry.ts'),'utf8'),master,service+' telemetry.ts differs from matching-service');
    for(const entry of ['main.ts','worker.ts']) {
      const source=path.join(file(service),entry); if(!fs.existsSync(source)) continue;
      assert.match(fs.readFileSync(source,'utf8').split('\n')[0],/^import ['"]\.\/bootstrap\/telemetry['"];$/,`${service} ${entry}`);
    }
  }
});
test('observability stack: one config per tool, every resource removable by label',()=>{
  const helpers={metadata:name=>({name,labels:{}}),secret:(name,data)=>({kind:'Secret',metadata:{name,labels:{}},stringData:data}),probeHTTP:(port,p)=>({httpGet:{port,path:p}}),
    deployment:(name,container,volumes)=>({kind:'Deployment',metadata:{name,labels:{}},container,volumes}),service:(name,ports)=>({kind:'Service',metadata:{name,labels:{}},ports})};
  const resources=observability.kubeResources(helpers,'secret-password');
  assert.deepEqual(resources.filter(r=>r.kind==='Deployment').map(r=>r.metadata.name),['otel-collector','jaeger','prometheus','grafana']);
  assert.ok(resources.every(r=>r.metadata.labels['app.kubernetes.io/component']==='observability'));
  // The Grafana password lives in a Secret, never in a ConfigMap or plain env.
  assert.ok(!JSON.stringify(resources.filter(r=>r.kind!=='Secret')).includes('secret-password'));
  const compose=observability.composeServices('/tmp/out','secret-password');
  assert.deepEqual(compose.grafana.ports,['127.0.0.1:13000:3000']); assert.equal(compose['otel-collector'].ports,undefined);
  for(const f of Object.values(observability.files())) JSON.parse(f.content);
});
test('dashboard only charts metrics the services really record',()=>{
  const sources=nodeServices.flatMap(service=>{const dir=path.join(__dirname,'..','service',service+'-service','src');return fs.readdirSync(dir,{recursive:true}).filter(f=>String(f).endsWith('metrics.ts')).map(f=>fs.readFileSync(path.join(dir,String(f)),'utf8'));}).join('\n');
  const dashboard=JSON.parse(observability.files()['chande-overview.json'].content);
  const charted=new Set(dashboard.panels.flatMap(p=>(p.targets??[]).flatMap(t=>t.expr.match(/\b(?:matching|trip|routing|realtime)_[a-z_]+/g)??[])));
  assert.ok(charted.size>=12);
  for(const name of charted) { const metric=name.replace(/_(total|bucket|count)$/,'').replace(/_milliseconds$/,''); assert.ok(sources.includes(`'${metric}'`),`${name} is charted but no service records ${metric}`); }
});
test('routing limits pass through only when set',()=>{
  const {routingTuning,osrmThreads}=require('./stack.cjs');
  assert.deepEqual(routingTuning({}),{}); assert.deepEqual(routingTuning({WORKER_POOL_SIZE:'4',UNRELATED:'1'}),{WORKER_POOL_SIZE:'4'});
  assert.equal(osrmThreads({}),'2'); assert.equal(osrmThreads({OSRM_THREADS:'4'}),'4'); assert.throws(()=>osrmThreads({OSRM_THREADS:'0'}),/OSRM_THREADS/);
});
