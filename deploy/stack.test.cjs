const {test}=require('node:test'),assert=require('node:assert/strict');
const {stack}=require('./stack.cjs');
const secrets=new Proxy({},{get:(_,key)=>'test-'+String(key).padEnd(64,'x')});
test('real issuer and callback topology keeps credentials scoped and public ports separate',()=>{
  const apps=stack(secrets);
  assert.equal(apps['trip-api'].env.AUTH_JWKS_URL,'http://user-api:3011/.well-known/jwks.json');
  assert.equal(apps['trip-worker'].env.GATEWAY_EVENTS_BASE_URL,'http://gateway-api:8090');
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
});
