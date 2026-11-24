const { test } = require('node:test'), assert = require('node:assert/strict');
const { loader, deferred, flush, owner, ids } = require('./helpers/driver.cjs');
test('Driver resource joins consumers, coalesces invalidations and discards old GET after replace', async () => {
  const { DriverResource } = loader()('src/features/driver/state/driver-resource.ts'), requests = [];
  const resource = new DriverResource(signal => { const d = deferred(); requests.push({ ...d, signal }); return d.promise; }, () => true);
  const a = resource.retain(), b = resource.retain(); assert.equal(requests.length, 1);
  resource.refresh(); resource.refresh(); resource.replace('confirmed-write'); requests[0].resolve('stale-get'); await flush();
  assert.equal(resource.getSnapshot().data, 'confirmed-write'); assert.equal(requests.length, 2);
  requests[1].resolve('fresh'); await flush(); assert.equal(resource.getSnapshot().data, 'fresh'); a(); assert.equal(requests[1].signal.aborted, false); b();
});
test('Driver resource resumes only after aborted read settles; owner loss cannot publish', async () => {
  const { DriverResource } = loader()('src/features/driver/state/driver-resource.ts'); let owns = true; const requests = [];
  const resource = new DriverResource(signal => { const d = deferred(); requests.push({ ...d, signal }); return d.promise; }, () => owns);
  const a = resource.retain(); a(); const b = resource.retain(); assert.equal(requests.length, 1); assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve('old'); await flush(); assert.equal(requests.length, 2); owns = false; resource.clear(); requests[1].resolve('other-owner'); await flush();
  assert.equal(resource.getSnapshot().data, undefined); assert.equal(resource.getSnapshot().loading, false); b();
});
test('Driver polling backs off dependency failure and stops after last lease', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  const { DriverResource } = loader()('src/features/driver/state/driver-resource.ts'); let calls = 0;
  const resource = new DriverResource(async () => { calls++; throw Error('dependency'); }, () => true);
  const release = resource.retain(10000); await flush(); t.mock.timers.tick(19999); await flush(); assert.equal(calls, 1);
  t.mock.timers.tick(1); await flush(); assert.equal(calls, 2); release(); t.mock.timers.tick(120000); await flush(); assert.equal(calls, 2);
});
test('Driver store shares by query and isolates owner/environment; inactive history never polls', async () => {
  const { DriverResourceStore } = loader()('src/features/driver/state/resource-store.ts'), session = owner(); let reads = 0;
  const runtime = { session, driver: { availability: async () => 'intent', profile: async () => 'profile', vehicles: async () => [] }, trip: { active: async () => null, history: async cursor => { reads++; return { items: [], cursor }; }, detail: async id => ({ tripId: id }) } };
  const a = new DriverResourceStore(runtime, session.getOwnerEpoch()), b = new DriverResourceStore(runtime, session.getOwnerEpoch());
  assert.equal(a.history('a'), a.history('a')); assert.notEqual(a.history('a'), a.history('b')); assert.notEqual(a.profile, b.profile);
  a.invalidateTrips(); await flush(); assert.equal(reads, 0);
  const release = a.history('a').retain(); await flush(); assert.equal(reads, 1);
  session.change(ids.other); a.clear(); a.history('a').retain()(); await flush(); assert.equal(reads, 1); release(); b.clear();
});
