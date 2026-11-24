const {test}=require('node:test'),assert=require('node:assert/strict'),{load}=require('../scripts/test-client.cjs');
const {tripPresentation,cancellationText,customerTripStates}=load('src/features/customer/trip-policy.ts');
// ADR-0004: a search that reaches its deadline is cancelled by SYSTEM with NO_DRIVER_FOUND; the rider must see that,
// not "Bạn đã hủy: NO_DRIVER_FOUND".
const trip=(status,cancellation)=>({tripId:'t',status,version:3,cancellation});
test('a no-driver cancellation has its own title and never shows the raw reason code',()=>{
  const noDriver=trip('CANCELLED',{actorType:'SYSTEM',reason:'NO_DRIVER_FOUND',cancelledAt:'2026-11-24T00:00:00Z'});
  assert.equal(tripPresentation(noDriver).title,'Không tìm thấy tài xế');
  assert.equal(cancellationText(noDriver),'Hệ thống đã hủy vì không tìm thấy tài xế.');
  const byRider=trip('CANCELLED',{actorType:'RIDER',reason:'Đổi ý',cancelledAt:'2026-11-24T00:00:00Z'});
  assert.equal(tripPresentation(byRider),customerTripStates.CANCELLED);
  assert.equal(cancellationText(byRider),'Bạn đã hủy: Đổi ý');
  assert.equal(cancellationText(trip('CANCELLED',{actorType:'DRIVER',reason:'Xe hỏng',cancelledAt:'x'})),'Tài xế đã hủy: Xe hỏng');
  assert.equal(cancellationText(trip('CANCELLED',null)),'Chưa có thông tin người hủy và lý do từ máy chủ.');
  assert.equal(tripPresentation(trip('SEARCHING',null)),customerTripStates.SEARCHING);
});
