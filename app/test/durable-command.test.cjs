const {test}=require('node:test'),assert=require('node:assert/strict'),{load}=require('../scripts/test-client.cjs');
const {DurableCommand}=load('src/features/backend/durable-command.ts');
test('lost response persists key/body across restart, blocks conflicting intent, then clears after replay',async()=>{
  let disk=null;const storage={read:async()=>disk,write:async c=>{disk=c}},command={key:'same-key',operation:'create',body:{quoteId:'same-quote'}};
  const first=new DurableCommand(storage);await first.restore();await assert.rejects(first.run(command,async()=>{assert.deepEqual(disk,command);throw {status:0,code:'TIMEOUT'}}));
  const second=new DurableCommand(storage);await second.restore();await assert.rejects(second.run({...command,key:'other'},async()=>{}),/COMMAND_UNRESOLVED/);
  assert.equal(await second.run(second.getSnapshot().pending,async c=>{assert.deepEqual(c,command);return 'replayed'}),'replayed');assert.equal(disk,null);
});
test('storage failure sends no request; definitive rejection clears but request-in-progress keeps intent',async()=>{
  let disk=null,calls=0;const c={key:'key',operation:'accept',body:{offerId:'offer'}};
  const failed=new DurableCommand({read:async()=>null,write:async()=>{throw Error('disk')}});await failed.restore();await assert.rejects(failed.run(c,async()=>{calls++}));assert.equal(calls,0);
  const manager=new DurableCommand({read:async()=>disk,write:async x=>{disk=x}});await manager.restore();
  await assert.rejects(manager.run(c,async()=>{throw {status:409,code:'REQUEST_IN_PROGRESS'}}));assert.deepEqual(disk,c);
  await assert.rejects(manager.run(c,async()=>{throw {status:409,code:'OFFER_EXPIRED'}}));assert.equal(disk,null);
});
