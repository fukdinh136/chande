const {test}=require('node:test'),assert=require('node:assert/strict'),{load}=require('../scripts/test-client.cjs');
const {decodePolyline}=load('src/features/map/polyline.ts');
test('polyline6 decodes exact longitude/latitude order and rejects truncated geometry',()=>{
  const encode=points=>{let lat=0,lng=0,out='';for(const p of points){for(const delta of [Math.round(p[1]*1e6)-lat,Math.round(p[0]*1e6)-lng]){let value=delta<0?~(delta<<1):delta<<1;while(value>=32){out+=String.fromCharCode((32|(value&31))+63);value>>>=5}out+=String.fromCharCode(value+63)}lat=Math.round(p[1]*1e6);lng=Math.round(p[0]*1e6)}return out};
  const points=[[105.8542,21.0285],[105.8355,21.0272]];assert.deepEqual(decodePolyline(encode(points)),points);assert.throws(()=>decodePolyline('a'));assert.throws(()=>decodePolyline(''));
});
