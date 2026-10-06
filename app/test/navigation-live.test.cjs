const {test}=require('node:test'),assert=require('node:assert/strict'),{randomInt}=require('node:crypto'),fs=require('node:fs'),{load}=require('../scripts/test-client.cjs');
const {BackendHttp}=load('src/features/backend/http.ts'),{UserApi,PreviewApi}=load('src/features/backend/clients.ts'),{decodePolyline}=load('src/features/map/polyline.ts');
test('live Hanoi rich route is DRIVER-only and contains real step geometry and bearings for pinned SDK', {skip:process.env.APP_INTEGRATION!=='1'},async()=>{
  const http=new BackendHttp(process.env.APP_BACKEND_URL??'http://127.0.0.1:18080'),api=new PreviewApi(http),users=new UserApi(http);let driver,rider;
  const request=(path,body)=>http.send({service:'driver',path,method:'POST',body});
  try{
    const challenge=(await request('/driver-auth/otp/request',{phoneNumber:'84900000007'})).data;driver=(await request('/driver-auth/otp/verify',{phoneNumber:'84900000007',challengeId:challenge.challengeId,otp:'123456'})).data;
    const origin={lat:21.0295,lng:105.8542},destination={lat:21.0272,lng:105.8355},result=await api.navigation(driver.accessToken,origin,destination,'CAR_7'),data=result.data;
    assert.equal(data.schemaVersion,1);assert.equal(data.geometryPrecision,6);assert.ok(decodePolyline(data.route.geometry).length>2);assert.ok(data.route.legs[0].steps.length>1);
    for(const leg of data.route.legs)for(const step of leg.steps){const minimum=step.maneuver.type==='arrive'&&step.distance===0?1:2;assert.ok(decodePolyline(step.geometry,minimum).length>=minimum);assert.equal(typeof step.maneuver.bearing_before,'number');assert.equal(typeof step.maneuver.bearing_after,'number')}
    fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/hanoi-navigation-route.json',JSON.stringify(data.route,null,2));
    const phone='+849'+String(randomInt(100000000)).padStart(8,'0');await users.register(phone,'NativeRouteTest123!','Navigation Contract');rider=await users.login(phone,'NativeRouteTest123!');await assert.rejects(api.navigation(rider.accessToken,origin,destination,'CAR_7'),e=>e.status===403);
    console.info('Rich Hanoi route pass: '+data.route.legs.reduce((n,l)=>n+l.steps.length,0)+' actual OSRM steps');
  }finally{if(driver)await request('/driver-auth/logout',{refreshToken:driver.refreshToken});if(rider)await users.logout(rider.refreshToken)}
});
