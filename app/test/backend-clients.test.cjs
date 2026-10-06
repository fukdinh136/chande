const {test}=require('node:test'),assert=require('node:assert/strict'),{load}=require('../scripts/test-client.cjs');
const {offer,UserApi,OfferApi,CustomerTripApi,PreviewApi}=load('src/features/backend/clients.ts');
const uuid='11111111-1111-4111-8111-111111111111';
test('offer validates state/expiry/money and rejects invented/malformed data',()=>{
  const raw={offerId:uuid,tripId:uuid,driverId:uuid,version:1,status:'PENDING',expiresAt:new Date().toISOString(),pickup:{lat:21,lng:105},destination:{lat:21,lng:106},vehicleType:'CAR_4',fare:{currency:'VND',amount:'9223372036854775807'}};
  assert.equal(offer(raw).fare.amount,raw.fare.amount);assert.equal(offer(null),null);assert.throws(()=>offer({...raw,status:'MATCHED'}));assert.throws(()=>offer({...raw,expiresAt:'yesterday'}));
});
test('client requests exactly backend public routes, methods, DTO fields and idempotency intent',async()=>{
  const seen=[],http={send:async r=>{seen.push(r);return {data:r.service==='matching'?{offerId:uuid,status:'ASSIGNMENT_PENDING',accepted:true}:null}}};
  await new UserApi(http).defaultPlace('rider',uuid);await new UserApi(http).deletePlace('rider',uuid);
  await new CustomerTripApi(http).create('rider',uuid,uuid);await new PreviewApi(http).recalculate('driver',{lat:21,lng:105},{lat:22,lng:106},'CAR_4');
  await new OfferApi(http).decide('driver',uuid,uuid,'accept');
  assert.deepEqual(seen.map(r=>r.method),['PUT','DELETE','POST','POST','POST']);assert.deepEqual(seen[2].body,{quoteId:uuid});assert.equal(seen[2].key,uuid);assert.equal(seen[3].body.currentLocation.lat,21);assert.deepEqual(seen[4].body,{});assert.equal(seen.some(r=>r.path.includes('/internal')),false);
});
