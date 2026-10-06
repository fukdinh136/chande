const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID,randomInt}=require('node:crypto'),{io}=require('socket.io-client'),{load}=require('../scripts/test-client.cjs');
const {BackendHttp}=load('src/features/backend/http.ts'),{UserApi,CustomerTripApi,OfferApi,quote}=load('src/features/backend/clients.ts'),{TripEvents}=load('src/features/backend/trip-events.ts'),decode=load('src/features/driver/contracts/decode.ts');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(read,accept,ms=45000){const end=Date.now()+ms;while(Date.now()<end){const value=await read();if(accept(value))return value;await delay(500)}throw Error('Polling deadline reached')}
test('real frontend clients: GPS -> RabbitMQ offer WebSocket -> accept/replay -> Trip ASSIGNED -> customer cancel', {skip:process.env.APP_INTEGRATION!=='1',timeout:120000},async()=>{
  const base=process.env.APP_BACKEND_URL??'http://127.0.0.1:18080',http=new BackendHttp(base),users=new UserApi(http),trips=new CustomerTripApi(http),offers=new OfferApi(http);
  let socket,gpsTimer,rider,driver,created,oldIntent,oldVehicle,events,tripNotices=0;const messages=[];
  const request=(path,method='GET',body,token,key)=>http.send({service:'driver',path,method,body,token,key});
  try {
    const challenge=(await request('/driver-auth/otp/request','POST',{phoneNumber:'84900000007'})).data;
    driver=(await request('/driver-auth/otp/verify','POST',{phoneNumber:'84900000007',challengeId:challenge.challengeId,otp:'123456'})).data;
    assert.equal((await trips.active(driver.accessToken)).data,null,'fixture driver must have no active trip');assert.equal(await offers.active(driver.accessToken),null,'fixture must have no reservation');
    const available=(await request('/drivers/me/availability','GET',undefined,driver.accessToken)).data;oldIntent=available.desiredStatus;oldVehicle=available.selectedVehicleId;
    await request('/drivers/me/availability','PUT',{desiredStatus:'OFFLINE'},driver.accessToken);
    await request('/drivers/me/selected-vehicle','PUT',{vehicleId:'20000000-0000-4000-8000-000000000007'},driver.accessToken);
    await request('/drivers/me/availability','PUT',{desiredStatus:'ONLINE'},driver.accessToken);
    await until(()=>request('/drivers/me/availability','GET',undefined,driver.accessToken),r=>r.data.realtimeStatus==='AVAILABLE');
    socket=io(base+'/realtime',{path:'/socket.io/',transports:['websocket'],forceNew:true,auth:{token:driver.accessToken}});
    socket.on('driver.trip.offer',message=>messages.push(message));
    await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Socket connection timeout')),10000);socket.once('connect',()=>{clearTimeout(t);resolve()});socket.once('connect_error',e=>{clearTimeout(t);reject(e)})});
    const gps=()=>new Promise((resolve,reject)=>socket.timeout(5000).emit('driver.location.update',{latitude:21.0295,longitude:105.8542,accuracy:5,recordedAt:new Date().toISOString()},(e,r)=>e?reject(e):r?.data?.accepted?resolve(r):reject(Error(r?.error?.code??'GPS_ACK'))));
    await gps();gpsTimer=setInterval(()=>{void gps().catch(()=>{})},10000);
    const phone='+849'+String(randomInt(100000000)).padStart(8,'0');await users.register(phone,'FrontendTest123!','Frontend Booking');rider=await users.login(phone,'FrontendTest123!');
    events=new TripEvents(base,async()=>rider.accessToken);events.subscribe(()=>tripNotices++);events.start();await until(async()=>tripNotices,v=>v>0,10000);const initialNotices=tripNotices;
    const q=quote((await trips.estimate(rider.accessToken,{lat:21.0285,lng:105.8542},{lat:21.0272,lng:105.8355},'CAR_7')).data);assert.equal(q.distance,2546);
    created=decode.trip((await trips.create(rider.accessToken,q.quoteId,randomUUID())).data);assert.equal(created.status,'SEARCHING');
    const offered=await until(()=>offers.active(driver.accessToken),o=>o?.tripId===created.tripId);assert.equal(offered.status,'PENDING');
    await until(async()=>messages,m=>m.some(x=>x.data.offerId===offered.offerId));
    const key=randomUUID(),accepted=await offers.decide(driver.accessToken,offered.offerId,key,'accept');assert.equal(accepted.accepted,true);assert.equal(accepted.status,'ASSIGNMENT_PENDING');
    assert.deepEqual(await offers.decide(driver.accessToken,offered.offerId,key,'accept'),accepted);
    const assigned=decode.trip((await until(()=>trips.active(rider.accessToken),r=>r.data?.status==='ASSIGNED')).data);assert.equal(assigned.driverId,driver.driver.driverId);assert.equal(assigned.fare.estimatedAmount,q.amount);
    await until(async()=>tripNotices,v=>v>initialNotices);const cancelled=decode.trip((await trips.cancel(rider.accessToken,created.tripId,assigned.version,'frontend booking smoke cleanup',randomUUID())).data);assert.equal(cancelled.status,'CANCELLED');
    await until(()=>offers.active(driver.accessToken),o=>o===null);assert.equal((await trips.active(driver.accessToken)).data,null);
    console.info('Frontend booking smoke passed: OSRM Hanoi, real GPS/offer WS, RabbitMQ, accept replay, Trip cancel, reservation released');
  } finally {
    if(gpsTimer)clearInterval(gpsTimer);socket?.disconnect();events?.stop();
    if(created&&rider){const active=decode.activeTrip((await trips.active(rider.accessToken)).data);if(active?.tripId===created.tripId)await trips.cancel(rider.accessToken,active.tripId,active.version,'test cleanup',randomUUID());}
    if(driver&&oldIntent){await until(()=>offers.active(driver.accessToken),o=>o===null);await request('/drivers/me/availability','PUT',{desiredStatus:'OFFLINE'},driver.accessToken);if(oldVehicle)await request('/drivers/me/selected-vehicle','PUT',{vehicleId:oldVehicle},driver.accessToken);await request('/drivers/me/availability','PUT',{desiredStatus:oldIntent},driver.accessToken);}
    if(rider)await users.logout(rider.refreshToken);if(driver)await request('/driver-auth/logout','POST',{refreshToken:driver.refreshToken});
  }
});

