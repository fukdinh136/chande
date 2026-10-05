const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { root, images, stack } = require('./stack.cjs');
const out = path.join(__dirname, '.local', 'backend');
fs.mkdirSync(out, { recursive: true });
const secretFile = path.join(out, 'credentials.json');
if (!fs.existsSync(secretFile)) {
  const keys = ['rootPassword','userPassword','driverPassword','tripPassword','matchingPassword','rabbitPassword','userInternal','cursor','matchingTrip','driverTrip','tripRouting','tripPrice','tripMatching','tripGateway','driverMatching','realtimeMatching','matchingRouting','matchingDriver','realtimeDriver','routingRealtime','gatewayRouting'];
  fs.writeFileSync(secretFile, JSON.stringify(Object.fromEntries(keys.map(k => [k, crypto.randomBytes(32).toString('hex')])), null, 2), { mode: 0o600 });
}
for (const key of ['user', 'driver']) if (!fs.existsSync(path.join(out, key + '.pem'))) {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(path.join(out, key + '.pem'), pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
}
const secrets = JSON.parse(fs.readFileSync(secretFile, 'utf8')), apps = stack(secrets);
const graph = path.join(root, 'service/routing-service/osrm/data/hanoi-car');
if (!fs.existsSync(path.join(graph, 'hanoi.osrm.partition'))) throw new Error('Prepare Hanoi OSRM graph before deploy: npm.cmd --prefix service/routing-service run osrm:prepare');
const driverSQL = fs.readFileSync(path.join(root, 'service/matching-service/test/fixtures/driver-local.sql'), 'utf8');
const init = `#!/bin/bash
set -euo pipefail
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres --set=user_password="$USER_DB_PASSWORD" --set=driver_password="$DRIVER_DB_PASSWORD" --set=trip_password="$TRIP_DB_PASSWORD" --set=matching_password="$MATCHING_DB_PASSWORD" <<'SQL'
CREATE USER user_service WITH PASSWORD :'user_password';
CREATE USER driver_service WITH PASSWORD :'driver_password';
CREATE USER trip_service WITH PASSWORD :'trip_password';
CREATE USER matching_service WITH PASSWORD :'matching_password';
CREATE DATABASE user_db OWNER user_service;
CREATE DATABASE driver_db OWNER driver_service;
CREATE DATABASE trip_db OWNER trip_service;
CREATE DATABASE matching_db OWNER matching_service;
SQL
psql -v ON_ERROR_STOP=1 -U driver_service -d driver_db -f /bootstrap/driver.sql
`;
fs.writeFileSync(path.join(out, 'init.sh'), init, 'utf8'); fs.writeFileSync(path.join(out, 'driver.sql'), driverSQL, 'utf8');
const postgresEnv = { POSTGRES_USER: 'backend_root', POSTGRES_PASSWORD: secrets.rootPassword, POSTGRES_DB: 'postgres', USER_DB_PASSWORD: secrets.userPassword, DRIVER_DB_PASSWORD: secrets.driverPassword, TRIP_DB_PASSWORD: secrets.tripPassword, MATCHING_DB_PASSWORD: secrets.matchingPassword };
const rabbitEnv = { RABBITMQ_DEFAULT_USER: 'backend', RABBITMQ_DEFAULT_PASS: secrets.rabbitPassword, RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS: '+S 2:2 +A 4' };
const absolute = file => path.resolve(file).replaceAll('\\', '/');
const compose = { name: 'chande-backend', services: {}, volumes: { postgres: {}, redis: {}, rabbit: {} } };
const health = test => ({ test, interval: '5s', timeout: '3s', retries: 40, start_period: '15s' });
compose.services.postgres = { image: images.postgres, environment: postgresEnv, volumes: ['postgres:/var/lib/postgresql', `${absolute(path.join(out,'init.sh'))}:/docker-entrypoint-initdb.d/init.sh:ro`,`${absolute(path.join(out,'driver.sql'))}:/bootstrap/driver.sql:ro`], healthcheck: health(['CMD-SHELL','pg_isready -U backend_root -d postgres']) };
compose.services.redis = { image: images.redis, command: ['redis-server','--appendonly','yes'], volumes:['redis:/data'], healthcheck:health(['CMD','redis-cli','ping']) };
compose.services.rabbitmq = { image: images.rabbit, user:'rabbitmq', hostname:'rabbitmq', environment: rabbitEnv, volumes:['rabbit:/var/lib/rabbitmq'], healthcheck:health(['CMD','rabbitmq-diagnostics','-q','ping']) };
const route = '/route/v1/driving/105.8542,21.0285;105.8355,21.0272?overview=false';
compose.services.osrm = { image: images.osrm, command:['osrm-routed','--algorithm','mld','--threads','2','--max-table-size','100','/data/hanoi.osrm'], volumes:[`${absolute(graph)}:/data:ro`], healthcheck:health(['CMD','curl','--fail','--silent','--max-time','2','http://127.0.0.1:5000'+route]) };
for (const [name, a] of Object.entries(apps)) {
  const probe = a.java ? ['CMD','curl','--fail','--silent',`http://127.0.0.1:${a.port}${a.ready}`] : ['CMD','node','-e',`fetch('http://127.0.0.1:${a.port}${a.ready}',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`];
  const envFile = path.join(out, name + '.env'); fs.writeFileSync(envFile, Object.entries(a.env).map(([k,v])=>k+'='+v).join('\n')+'\n', { mode:0o600 });
  const dependencies = { postgres: {condition:'service_healthy'}, redis: {condition:'service_healthy'} };
  if (a.migration) dependencies[name.replace('-api','-migrate')] = {condition:'service_completed_successfully'};
  if (name==='realtime-api') dependencies.rabbitmq = {condition:'service_healthy'};
  for (const dependency of a.dependencies ?? []) dependencies[dependency] = {condition:'service_healthy'};
  const keyName = a.service==='user' ? 'user.pem' : 'driver.pem';
  compose.services[name] = { image:a.image, init:true, env_file:[absolute(envFile)], depends_on:dependencies, healthcheck:health(probe), stop_grace_period:'60s', ...(a.command ? {command:a.command}:{}), ...(a.keys ? {volumes:[`${absolute(path.join(out,keyName))}:/run/keys/${keyName}:ro`]}:{}) };
  if (a.migration) compose.services[name.replace('-api','-migrate')] = {image:a.image, env_file:[absolute(envFile)], command:['node','dist/migrate.js'], depends_on:{postgres:{condition:'service_healthy'}}};
}
compose.services.edge = { image:images.nginx, volumes:[`${absolute(path.join(__dirname,'nginx.conf'))}:/etc/nginx/nginx.conf:ro`], ports:['127.0.0.1:18080:8088'], depends_on:{'gateway-api':{condition:'service_healthy'},'realtime-api':{condition:'service_healthy'}}, healthcheck:health(['CMD','wget','-q','--spider','http://127.0.0.1:8088/health/live']) };
fs.writeFileSync(path.join(out,'compose.json'),JSON.stringify(compose,null,2));

const ns = 'chande-local', labels = name => ({'app.kubernetes.io/name':name,'app.kubernetes.io/part-of':'chande'}), metadata = name => ({name,namespace:ns,labels:labels(name)});
const infra = [{apiVersion:'v1',kind:'Namespace',metadata:{name:ns,labels:{'app.kubernetes.io/part-of':'chande'}}}];
const workloads = [], migrations = [];
const secret = (name, data) => ({apiVersion:'v1',kind:'Secret',metadata:metadata(name),type:'Opaque',stringData:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,String(v)]))});
infra.push(secret('postgres-env',postgresEnv),secret('rabbitmq-env',rabbitEnv),secret('signing-keys',{'user.pem':fs.readFileSync(path.join(out,'user.pem'),'utf8'),'driver.pem':fs.readFileSync(path.join(out,'driver.pem'),'utf8')}));
infra.push({apiVersion:'v1',kind:'ConfigMap',metadata:metadata('postgres-bootstrap'),data:{'init.sh':init,'driver.sql':driverSQL}},{apiVersion:'v1',kind:'ConfigMap',metadata:metadata('nginx-config'),data:{'nginx.conf':fs.readFileSync(path.join(__dirname,'nginx.conf'),'utf8')}});
const probeHTTP = (port, path) => ({httpGet:{port,path},periodSeconds:5,timeoutSeconds:3,failureThreshold:6});
function service(name, ports, type, nodePort) { return {apiVersion:'v1',kind:'Service',metadata:metadata(name),spec:{selector:labels(name),...(type?{type}:{}),ports:ports.map((port,i)=>({name:'port-'+port,port,targetPort:port,...(nodePort && i===0 ? {nodePort}: {})}))}}; }
function deployment(name, container, volumes = [], memory = '256Mi') {
  return {apiVersion:'apps/v1',kind:'Deployment',metadata:metadata(name),spec:{replicas:1,strategy:{type:'Recreate'},selector:{matchLabels:labels(name)},template:{metadata:{labels:labels(name)},spec:{automountServiceAccountToken:false,terminationGracePeriodSeconds:60,containers:[{name,imagePullPolicy:'IfNotPresent',resources:{requests:{cpu:'50m',memory:'64Mi'},limits:{cpu:'2',memory}},...container}],volumes}}}};
}
for (const name of ['postgres','redis','rabbitmq']) infra.push({apiVersion:'v1',kind:'PersistentVolumeClaim',metadata:metadata(name+'-data'),spec:{accessModes:['ReadWriteOnce'],resources:{requests:{storage:name==='postgres'?'2Gi':'1Gi'}}}});
infra.push(deployment('postgres',{image:images.postgres,envFrom:[{secretRef:{name:'postgres-env'}}],ports:[{containerPort:5432}],readinessProbe:{exec:{command:['pg_isready','-U','backend_root','-d','postgres']},periodSeconds:5},volumeMounts:[{name:'data',mountPath:'/var/lib/postgresql'},{name:'init',mountPath:'/docker-entrypoint-initdb.d'},{name:'bootstrap',mountPath:'/bootstrap'}]},[{name:'data',persistentVolumeClaim:{claimName:'postgres-data'}},{name:'init',configMap:{name:'postgres-bootstrap',items:[{key:'init.sh',path:'init.sh'}]}},{name:'bootstrap',configMap:{name:'postgres-bootstrap'}}],'512Mi'),service('postgres',[5432]));
infra.push(deployment('redis',{image:images.redis,args:['redis-server','--appendonly','yes'],readinessProbe:{exec:{command:['redis-cli','ping']},periodSeconds:5},volumeMounts:[{name:'data',mountPath:'/data'}]},[{name:'data',persistentVolumeClaim:{claimName:'redis-data'}}],'256Mi'),service('redis',[6379]));
infra.push(deployment('rabbitmq',{image:images.rabbit,envFrom:[{secretRef:{name:'rabbitmq-env'}}],readinessProbe:{tcpSocket:{port:5672},periodSeconds:5},volumeMounts:[{name:'data',mountPath:'/var/lib/rabbitmq'}]},[{name:'data',persistentVolumeClaim:{claimName:'rabbitmq-data'}}],'512Mi'),service('rabbitmq',[5672]));
const rabbitPod = infra.find(r=>r.kind==='Deployment' && r.metadata.name==='rabbitmq').spec.template.spec;
rabbitPod.hostname='rabbitmq'; rabbitPod.securityContext={fsGroup:999};
rabbitPod.containers[0].securityContext={runAsUser:999,runAsGroup:999,runAsNonRoot:true};
const drivePath = absolute(graph).replace(/^([A-Za-z]):/,(_,drive)=>'/run/desktop/mnt/host/'+drive.toLowerCase());
infra.push(deployment('osrm',{image:images.osrm,args:compose.services.osrm.command,readinessProbe:probeHTTP(5000,route),volumeMounts:[{name:'graph',mountPath:'/data',readOnly:true}]},[{name:'graph',hostPath:{path:drivePath,type:'Directory'}}],'1Gi'),service('osrm',[5000]));
for (const [name,a] of Object.entries(apps)) {
  infra.push(secret(name+'-env',a.env));
  const keyName = a.service==='user' ? 'user.pem' : 'driver.pem';
  const volumes = a.keys ? [{name:'keys',secret:{secretName:'signing-keys',defaultMode:0o444,items:[{key:keyName,path:keyName}]}}] : [];
  const container = {image:a.image,envFrom:[{secretRef:{name:name+'-env'}}],ports:[{containerPort:a.port}],readinessProbe:probeHTTP(a.port,a.ready),livenessProbe:a.service==='user'?{tcpSocket:{port:a.port},periodSeconds:5}:probeHTTP(a.port,a.live),startupProbe:{...probeHTTP(a.port,a.ready),failureThreshold:60},...(a.command?{command:a.command}:{}),...(a.keys?{volumeMounts:[{name:'keys',mountPath:'/run/keys',readOnly:true}]}:{})};
  const resource = deployment(name,container,volumes,a.java?'768Mi':'384Mi');
  if (a.worker) resource.spec.template.spec.initContainers = [{name:'wait-api',image:a.image,imagePullPolicy:'IfNotPresent',command:['node','-e',`const u='http://${a.dependencies[0]}:${apps[a.dependencies[0]].port}/health/ready'; (async()=>{for(let n=0;n<180;n++){try{if((await fetch(u)).ok)return}catch{}await new Promise(r=>setTimeout(r,1000))}process.exit(1)})()`]}];
  workloads.push(resource,service(name,name==='gateway-api'?[8080,8090]:[a.port]));
  if (a.migration) migrations.push({apiVersion:'batch/v1',kind:'Job',metadata:metadata(name.replace('-api','-migrate')),spec:{backoffLimit:3,activeDeadlineSeconds:180,template:{metadata:{labels:labels(name.replace('-api','-migrate'))},spec:{restartPolicy:'Never',automountServiceAccountToken:false,containers:[{name:'migrate',image:a.image,imagePullPolicy:'IfNotPresent',command:['node','dist/migrate.js'],envFrom:[{secretRef:{name:name+'-env'}}]}]}}}});
}
workloads.push(deployment('edge',{image:images.nginx,readinessProbe:probeHTTP(8088,'/health/live'),volumeMounts:[{name:'config',mountPath:'/etc/nginx/nginx.conf',subPath:'nginx.conf',readOnly:true}]},[{name:'config',configMap:{name:'nginx-config'}}],'128Mi'),service('edge',[8088]));
const imageIdsFile = path.join(out, 'images.json');
if (fs.existsSync(imageIdsFile)) {
  const ids = JSON.parse(fs.readFileSync(imageIdsFile, 'utf8'));
  for (const resource of workloads.filter(r=>r.kind==='Deployment')) resource.spec.template.metadata.annotations = {'chande.dev/image-id':ids[resource.spec.template.spec.containers[0].image] ?? 'infra'};
}
for (const [name,items] of Object.entries({infra,migrations,workloads})) fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify({apiVersion:'v1',kind:'List',items},null,2),{mode:0o600});
console.info('Generated private Docker/Kubernetes configuration; credentials/keys preserved. Namespace chande-local; Docker :18080; Kubernetes port-forward :18081.');
module.exports = {out,apps,root};
