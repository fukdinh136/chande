const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID,randomInt}=require('node:crypto'),{load}=require('../scripts/test-client.cjs');
const {BackendHttp}=load('src/features/backend/http.ts'),{discover}=load('src/features/backend/discovery.ts'),{UserApi,CustomerTripApi,OfferApi,PreviewApi}=load('src/features/backend/clients.ts');
test('same frontend clients discover live Gateway, handle User CRUD/204 and replay/cancel Trip', {skip:process.env.APP_INTEGRATION!=='1'},async()=>{
  const base=await discover({development:true,platform:'web',explicit:process.env.APP_BACKEND_URL}),http=new BackendHttp(base),users=new UserApi(http),trips=new CustomerTripApi(http),routes=new PreviewApi(http);
  const phone='+849'+String(randomInt(100000000)).padStart(8,'0'),password='FrontendTest123!';
  const registered=await users.register(phone,password,'Frontend Integration'),session=await users.login(phone,password),token=session.accessToken;
  assert.equal((await users.profile(token)).id,registered.id);
  const place=await users.createPlace(token,{label:'Test',addressText:'Frontend Hanoi fixture',lat:21.0285,lng:105.8542,makeDefault:true});
  assert.equal((await users.defaultPlace(token,place.id)).isDefault,true);await users.deletePlace(token,place.id);assert.deepEqual(await users.places(token),[]);
  const pickup={lat:21.0285,lng:105.8542},destination={lat:21.0272,lng:105.8355};assert.equal((await routes.route(token,pickup,destination,'CAR_4')).data.distanceMeters,2546);
  const quote=(await trips.estimate(token,pickup,destination,'CAR_4')).data;assert.equal(quote.fare.amount,'27460');const key=randomUUID(),created=await trips.create(token,quote.quoteId,key),replay=await trips.create(token,quote.quoteId,key);assert.equal(created.data.tripId,replay.data.tripId);assert.equal(replay.replayed,true);
  const cancelled=(await trips.cancel(token,created.data.tripId,created.data.version,'frontend integration cleanup',randomUUID())).data;assert.equal(cancelled.status,'CANCELLED');assert.equal((await trips.active(token)).data,null);
  assert.equal((await trips.history(token)).data.items[0].tripId,created.data.tripId);await users.logout(session.refreshToken);
  console.info('Frontend client live contract pass: '+base);
});
test('Driver OTP, profile and offer lookup bind to real Gateway with DRIVER audience', {skip:process.env.APP_INTEGRATION!=='1'},async()=>{
  const base=await discover({development:true,platform:'web',explicit:process.env.APP_BACKEND_URL}),http=new BackendHttp(base);
  const challenge=(await http.send({service:'driver',path:'/driver-auth/otp/request',method:'POST',body:{phoneNumber:'84900000004'}})).data;
  const session=(await http.send({service:'driver',path:'/driver-auth/otp/verify',method:'POST',body:{phoneNumber:'84900000004',challengeId:challenge.challengeId,otp:'123456'}})).data;
  const profile=(await http.send({service:'driver',path:'/drivers/me',token:session.accessToken})).data;assert.equal(profile.driverId,session.driver.driverId);
  const offers=new OfferApi(http);assert.equal(await offers.active(session.accessToken),null);
  await http.send({service:'driver',path:'/driver-auth/logout',method:'POST',body:{refreshToken:session.refreshToken}});
});
