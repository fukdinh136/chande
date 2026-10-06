import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../../src/api/http';
import {RoutingRuntime} from '../../src/bootstrap/runtime';
import {config,point} from '../helpers/fixtures';
import {navigationRouteSchema} from '../../src/domain/navigation';
test('navigation uses Gateway scope and full route job; estimate and matrix contract remain separate',async()=>{
  const runtime=new RoutingRuntime(config()),app=await createApp(runtime);await app.listen(0,'127.0.0.1');
  try{
    const body={origin:point,destination:{lat:10.78,lng:106.7},vehicleType:'MOCK_BIKE'};
    const url=await app.getUrl();const call=(token:string)=>fetch(url+'/routes/navigation',{method:'POST',headers:{'content-type':'application/json','x-service-token':token},body:JSON.stringify(body)});
    assert.equal((await call('matching-test-token')).status,403);assert.equal((await call('trip-test-token')).status,403);
    const response=await call('gateway-test-token');assert.equal(response.status,200);const result=await response.json();assert.equal(result.data.geometryPrecision,6);assert.equal(result.data.schemaVersion,1);assert.ok(navigationRouteSchema.safeParse(result.data.route).success);assert.equal(result.data.route.legs[0].steps.length,2);
  }finally{await app.close()}
});
