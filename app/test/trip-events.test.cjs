const {test}=require('node:test'),assert=require('node:assert/strict'),{load}=require('../scripts/test-client.cjs');
const {TripEvents}=load('src/features/backend/trip-events.ts');
test('socket authenticates then invalidates REST; cleanup and logout suppress late sockets/events',async()=>{
  let socket,notices=0,sent=[];const events=new TripEvents('https://example.test',async()=>'access',url=>{assert.equal(url,'wss://example.test/ws');return socket={send:x=>sent.push(JSON.parse(x)),close(){this.closed=true}}});
  events.subscribe(()=>notices++);events.start();await new Promise(r=>setImmediate(r));socket.onopen();assert.deepEqual(sent,[{type:'auth',token:'access'}]);socket.onmessage({data:'garbage'});assert.equal(notices,0);socket.onmessage({data:'{"type":"auth.ok"}'});socket.onmessage({data:'{"type":"trip.event","event":{"version":1}}'});assert.equal(notices,2);events.stop();assert.equal(socket.closed,true);assert.equal(socket.onmessage,null);
  let finish;const waiting=new TripEvents('http://host',()=>new Promise(r=>finish=r),()=>{throw Error('opened after logout')});waiting.start();waiting.stop();finish('late');await new Promise(r=>setImmediate(r));
});
