const assert = require('node:assert/strict'), {randomUUID, randomInt} = require('node:crypto');
const {io} = require('../service/matching-service/node_modules/socket.io-client');
const base = (process.env.BACKEND_URL || 'http://127.0.0.1:18080').replace(/\/$/,'');
if (!['127.0.0.1','localhost'].includes(new URL(base).hostname)) throw new Error('Smoke uses local fixture accounts; only loopback targets are allowed');
const pause = ms=>new Promise(r=>setTimeout(r,ms));
async function request(path,body,token,expected=200,extra={},method) {
  const response=await fetch(base+'/api/v1'+path,{method:method??(body===undefined?'GET':'POST'),signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-Request-Id':randomUUID(),...(token?{Authorization:'Bearer '+token}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const raw=await response.json(); assert.equal(response.status,expected,`${path}: ${raw.error?.code??raw.code??response.status}`);
  return {data:Object.hasOwn(raw,'data')?raw.data:raw,response};
}
async function poll(work,predicate,timeout=40000) {const end=Date.now()+timeout;while(Date.now()<end){const value=await work();if(predicate(value))return value;await pause(300)}throw new Error('SMOKE_POLL_TIMEOUT')}
async function rider() {
  const phoneNumber='+849'+String(randomInt(0,100000000)).padStart(8,'0'),password='BackendSmoke123!';
  const {data:registered}=await request('/auth/register',{phoneNumber,password,fullName:'Hanoi Backend Smoke'},undefined,201);
  const {data:session}=await request('/auth/login',{phoneNumber,password});
  const {data:profile}=await request('/users/me',undefined,session.accessToken); assert.equal(profile.id,registered.id);
  return session.accessToken;
}
async function tripSocket(token) {
  const socket=new WebSocket(base.replace(/^http/,'ws')+'/ws'),events=[];
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('TRIP_SOCKET_TIMEOUT')),10000);socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('TRIP_SOCKET_ERROR'))},{once:true});socket.addEventListener('open',()=>socket.send(JSON.stringify({type:'auth',token})),{once:true});socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.type==='auth.ok'){clearTimeout(timer);resolve()}if(m.type==='trip.event')events.push(m.event)})});
  return {socket,events};
}
async function scenario(type,terminal) {
  const suffix=type==='CAR_4'?'4':'7',driverId=`10000000-0000-4000-8000-00000000000${suffix}`;
  const {data:challenge}=await request('/driver-auth/otp/request',{phoneNumber:'8490000000'+suffix});
  const {data:session}=await request('/driver-auth/otp/verify',{phoneNumber:'8490000000'+suffix,challengeId:challenge.challengeId,otp:'123456'}),token=session.accessToken;
  const {data:active}=await request('/trips/active',undefined,token);
  if(active&&['SEARCHING','ASSIGNED','DRIVER_ARRIVED'].includes(active.status))await request(`/trips/${active.tripId}/cancel`,{version:active.version,reason:'backend fixture cleanup'},token,200,{'Idempotency-Key':randomUUID()});
  await poll(async()=>(await request('/matching/offers/active',undefined,token)).data,o=>o===null);
  await request('/drivers/me/availability',{desiredStatus:'OFFLINE'},token,200,{},'PUT');
  await request('/drivers/me/selected-vehicle',{vehicleId:`20000000-0000-4000-8000-00000000000${suffix}`},token,200,{},'PUT');
  await request('/drivers/me/availability',{desiredStatus:'ONLINE'},token,200,{},'PUT');
  const customer=await rider(),stream=await tripSocket(customer);
  const gpsSocket=io(base+'/realtime',{transports:['websocket'],auth:{token},reconnection:false}); let interval;
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('GPS_SOCKET_TIMEOUT')),10000);gpsSocket.once('connect',()=>{clearTimeout(timer);resolve()});gpsSocket.once('connect_error',()=>{clearTimeout(timer);reject(new Error('GPS_CONNECT_ERROR'))})});
    const gps=()=>({latitude:21.0295,longitude:105.8542,accuracy:5,recordedAt:new Date().toISOString()});
    const receipt=await new Promise((resolve,reject)=>gpsSocket.timeout(5000).emit('driver.location.update',gps(),(e,r)=>e?reject(e):resolve(r)));assert.equal(receipt.data.accepted,true);
    interval=setInterval(()=>gpsSocket.emit('driver.location.update',gps()),2000);
    const offers=[];gpsSocket.on('driver.trip.offer',m=>offers.push(m.data));
    const input={pickup:{lat:21.0285,lng:105.8542},destination:{lat:21.0272,lng:105.8355},vehicleType:type};
    const {data:route}=await request('/routes',{origin:input.pickup,destination:input.destination,vehicleType:type,includeSteps:false},customer,200,{'X-Service-Token':'client-spoof'});assert.equal(route.distanceMeters,2546);
    const {data:quote}=await request('/trips/estimate',input,customer);assert.equal(quote.route.distanceMeters,2546);assert.equal(quote.fare.amount,'27460');
    const createKey=randomUUID(); let {data:trip}=await request('/trips',{quoteId:quote.quoteId},customer,201,{'Idempotency-Key':createKey});
    const replay=await request('/trips',{quoteId:quote.quoteId},customer,201,{'Idempotency-Key':createKey,'Origin':'http://localhost:5500'});assert.equal(replay.data.tripId,trip.tripId);assert.equal(replay.response.headers.get('Idempotent-Replay'),'true');assert.match(replay.response.headers.get('Access-Control-Expose-Headers'),/Idempotent-Replay/);
    const offer=await poll(async()=>offers.find(o=>o.tripId===trip.tripId),Boolean);assert.equal(offer.driverId,driverId);
    assert.equal((await request('/drivers/me/availability',undefined,token)).data.realtimeStatus,'BUSY');
    const denied=await fetch(base+'/api/v1/matching/offers/'+offer.offerId,{headers:{Authorization:'Bearer '+customer}});assert.equal(denied.status,403);
    const matrix=await fetch(base+'/api/v1/routes/matrix',{method:'POST',headers:{Authorization:'Bearer '+customer,'Content-Type':'application/json'},body:'{}'});assert.equal(matrix.status,403);
    const hidden=await fetch(base+'/internal/events/trips');assert.equal(hidden.status,404);
    const key=randomUUID();const accepted=await request(`/matching/offers/${offer.offerId}/accept`,{},token,202,{'Idempotency-Key':key});assert.deepEqual((await request(`/matching/offers/${offer.offerId}/accept`,{},token,202,{'Idempotency-Key':key})).data,accepted.data);
    trip=await poll(async()=>(await request('/trips/'+trip.tripId,undefined,customer)).data.trip,t=>t.status==='ASSIGNED');assert.equal(trip.driverId,driverId);
    await poll(async()=>stream.events.find(e=>e.tripId===trip.tripId&&e.type==='trip.assigned'),Boolean); // Real Gateway -> Redis -> /ws.
    if(terminal==='COMPLETED')for(const status of ['DRIVER_ARRIVED','IN_PROGRESS','COMPLETED'])trip=(await request(`/trips/${trip.tripId}/status`,{status,version:trip.version},token,200,{'Idempotency-Key':randomUUID()},'PATCH')).data;
    else trip=(await request(`/trips/${trip.tripId}/cancel`,{reason:'backend smoke',version:trip.version},customer,200,{'Idempotency-Key':randomUUID()})).data;
    assert.equal(trip.status,terminal);if(terminal==='COMPLETED')assert.equal(trip.fare.finalAmount,quote.fare.amount);
    await poll(async()=>(await request('/matching/offers/active',undefined,token)).data,o=>o===null);
    await poll(async()=>(await request('/drivers/me/availability',undefined,token)).data,s=>s.realtimeStatus==='AVAILABLE');
    await request('/drivers/me/availability',{desiredStatus:'OFFLINE'},token,200,{},'PUT');
    console.info(JSON.stringify({base,scenario:type,tripId:trip.tripId,status:trip.status,routeMeters:route.distanceMeters,fareVnd:quote.fare.amount,realUser:true,gatewayRest:true,tripEventsWebSocket:true,realtimeSocketIO:true,reservationReleased:true}));
  } finally {if(interval)clearInterval(interval);gpsSocket.disconnect();stream.socket.close()}
}
(async()=>{await scenario('CAR_4','COMPLETED');await scenario('CAR_7','CANCELLED')})().catch(e=>{console.error(e.message);process.exitCode=1});
