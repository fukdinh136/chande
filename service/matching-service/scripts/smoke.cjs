const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const { io } = require('socket.io-client');
const roots = { trip: process.env.SMOKE_TRIP_URL || 'http://127.0.0.1:13001', driver: process.env.SMOKE_DRIVER_URL || 'http://127.0.0.1:3008', realtime: process.env.SMOKE_REALTIME_URL || 'http://127.0.0.1:3009', matching: process.env.SMOKE_MATCHING_URL || 'http://127.0.0.1:3007', mocks: process.env.SMOKE_MOCK_URL || 'http://127.0.0.1:13003' };
async function request(service, path, body, token, expected=200, extra={}) {
  const r = await fetch(roots[service] + path, { method: body===undefined ? 'GET' : 'POST', signal:AbortSignal.timeout(10000), headers: { 'Content-Type':'application/json', 'X-Request-Id':randomUUID(), ...(token ? {Authorization:'Bearer '+token}:{}), ...extra }, ...(body===undefined ? {} : {body:JSON.stringify(body)}) });
  const raw = await r.json(); assert.equal(r.status,expected,`${service} ${path}: ${raw.error?.code}`); return raw.data;
}
async function put(path, body, token) { const r=await fetch(roots.driver+path,{method:'PUT',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)}); const raw=await r.json(); assert.equal(r.status,200,raw.error?.code); return raw.data; }
const pause = ms => new Promise(r=>setTimeout(r,ms));
async function poll(work, predicate, timeout=30000) { const end=Date.now()+timeout; while(Date.now()<end) { const result=await work(); if(predicate(result)) return result; await pause(300); } throw new Error('SMOKE_POLL_TIMEOUT'); }
async function scenario(type, finish) {
  const suffix = type==='CAR_4'?'4':'7', driverId=`10000000-0000-4000-8000-00000000000${suffix}`;
  const challenge = await request('driver','/driver-auth/otp/request',{phoneNumber:'8490000000'+suffix});
  const session = await request('driver','/driver-auth/otp/verify',{phoneNumber:'8490000000'+suffix,challengeId:challenge.challengeId,otp:'123456'}); const token=session.accessToken;
  // Repeatable smoke only uses its two fixture drivers, keeping other data untouched.
  const active = await request('trip','/trips/active',undefined,token);
  if(active && ['ASSIGNED','DRIVER_ARRIVED','SEARCHING'].includes(active.status)) await request('trip',`/trips/${active.tripId}/cancel`,{reason:'smoke fixture cleanup',version:active.version},token,200,{'Idempotency-Key':randomUUID()});
  await put('/drivers/me/availability',{desiredStatus:'OFFLINE'},token);
  await poll(()=>request('matching','/matching/offers/active',undefined,token),o=>o===null);
  await put('/drivers/me/selected-vehicle',{vehicleId:`20000000-0000-4000-8000-00000000000${suffix}`},token); await put('/drivers/me/availability',{desiredStatus:'ONLINE'},token);
  const socket=io(roots.realtime+'/realtime',{transports:['websocket'],auth:{token},reconnection:false});
  let locationTimer;
  try {
    await new Promise((resolve,reject)=> { const timer=setTimeout(()=>reject(new Error('SOCKET_TIMEOUT')),10000); socket.once('connect',()=>{clearTimeout(timer);resolve()}); socket.once('connect_error',e=>{clearTimeout(timer);reject(e)}); });
    const gps=()=>({latitude:21.0295,longitude:105.8542,accuracy:5,recordedAt:new Date().toISOString()});
    const receipt = await new Promise((resolve,reject)=>socket.timeout(5000).emit('driver.location.update',gps(),(error,value)=>error?reject(error):resolve(value))); assert.equal(receipt.data.accepted,true);
    locationTimer=setInterval(()=>socket.emit('driver.location.update',gps()),2000);
    const offers=[]; socket.on('driver.trip.offer', message=>offers.push(message.data));
    const rider=(await request('mocks','/mock/token',{sub:randomUUID(),role:'RIDER'})).accessToken;
    const quote=await request('trip','/trips/estimate',{pickup:{lat:21.0285,lng:105.8542},destination:{lat:21.0272,lng:105.8355},vehicleType:type},rider);
    assert.equal(quote.route.distanceMeters,2546); assert.equal(quote.fare.amount,'27460');
    let trip=await request('trip','/trips',{quoteId:quote.quoteId},rider,201,{'Idempotency-Key':randomUUID()});
    const offer=await poll(async()=>offers.find(o=>o.tripId===trip.tripId),o=>!!o); assert.equal(offer.driverId,driverId); assert.equal(offer.vehicleType,type);
    // Reconnect recovers same offer/deadline from authoritative Matching, no new 20 seconds.
    socket.disconnect(); socket.connect(); await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('RECONNECT_TIMEOUT')),5000);socket.once('connect',()=>{clearTimeout(timer);resolve()})});
    await poll(async()=>offers.filter(o=>o.offerId===offer.offerId).length,n=>n>=2,5000);
    const same=await request('matching','/matching/offers/'+offer.offerId,undefined,token); assert.equal(same.expiresAt,offer.expiresAt);
    assert.equal((await request('driver','/drivers/me/availability',undefined,token)).realtimeStatus,'BUSY');
    const key=randomUUID(); const accepted=await request('matching',`/matching/offers/${offer.offerId}/accept`,{},token,202,{'Idempotency-Key':key});
    assert.deepEqual(await request('matching',`/matching/offers/${offer.offerId}/accept`,{},token,202,{'Idempotency-Key':key}),accepted);
    trip=await poll(async()=>(await request('trip','/trips/'+trip.tripId,undefined,rider)).trip,t=>t.status==='ASSIGNED'); assert.equal(trip.driverId,driverId); assert.equal(trip.fare.estimatedAmount,quote.fare.amount);
    if(finish==='complete') {
      for(const status of ['DRIVER_ARRIVED','IN_PROGRESS','COMPLETED']) { const r=await fetch(roots.trip+`/trips/${trip.tripId}/status`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'Idempotency-Key':randomUUID()},body:JSON.stringify({status,version:trip.version})});const raw=await r.json();assert.equal(r.status,200,raw.error?.code);trip=raw.data; }
      assert.equal(trip.fare.finalAmount,quote.fare.amount);
    } else trip=await request('trip',`/trips/${trip.tripId}/cancel`,{reason:'Hanoi smoke cancellation',version:trip.version},rider,200,{'Idempotency-Key':randomUUID()});
    await poll(()=>request('matching','/matching/offers/active',undefined,token),o=>o===null);
    const reservations=await request('matching','/internal/matching/reservations/batch',{driverIds:[driverId]},undefined,200,{'X-Service-Token':'local-driver-matching-token-000001'}); assert.equal(reservations.items[0].tripId,null);
    assert.equal((await request('driver','/drivers/me/availability',undefined,token)).realtimeStatus,'AVAILABLE');
    await put('/drivers/me/availability',{desiredStatus:'OFFLINE'},token);
    console.info(JSON.stringify({scenario:type,result:trip.status,tripId:trip.tripId,offerId:offer.offerId,routeMeters:quote.route.distanceMeters,fareVnd:quote.fare.amount,websocket:true,reconnect:true,reservationReleased:true}));
  } finally {if(locationTimer)clearInterval(locationTimer);socket.disconnect();}
}
(async()=> { await scenario('CAR_4','complete'); await scenario('CAR_7','cancel'); })().catch(error=>{console.error(error.message);process.exitCode=1});
