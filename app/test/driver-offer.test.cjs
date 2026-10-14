const { test } = require('node:test'), assert = require('node:assert/strict');
const { loader, deferred, flush, ids, owner, memoryStorage } = require('./helpers/driver.cjs');
async function fixture(t, storage = memoryStorage()) {
  const load = loader(), { OfferCoordinator } = load('src/features/driver/state/offer-coordinator.ts'), { DriverMatchingClient } = load('src/features/driver/clients/matching-client.ts'), { ApiError } = load('src/features/driver/http/errors.ts');
  const session = owner(), config = { mode: 'direct', driverBase: 'http://driver.test', tripBase: 'http://trip.test', matchingBase: 'http://matching.test', matchingPrefix: '', capabilities: { matching: { configured: true } } };
  let offer = { offerId: ids.offer, tripId: ids.trip, driverId: ids.driver, version: 1, status: 'PENDING', expiresAt: new Date(Date.now() + 60000).toISOString(), pickup: { lat: 21, lng: 105 }, destination: { lat: 21.1, lng: 105.1 }, vehicleType: 'BIKE', fare: { currency: 'VND', amount: '30000' } };
  const calls = [], decision = deferred(); let read = async () => offer;
  session.request = async spec => { calls.push(spec); return { data: spec.method === 'POST' ? await decision.promise : await read(spec) }; };
  const coordinator = new OfferCoordinator(new DriverMatchingClient(config, session), session, storage, config);
  t.after(() => coordinator.stop());
  coordinator.start(ids.driver, () => {}); coordinator.observeActive({ data: null, loading: false, error: null, checkedAt: Date.now() }); coordinator.setForeground(true); await flush();
  assert.equal(coordinator.getSnapshot().canAccept, true);
  return { load, coordinator, session, storage, calls, decision, ApiError, config, get offer() { return offer; }, set offer(value) { offer = value; }, setRead: fn => { read = fn; }, posts: () => calls.filter(c => c.method === 'POST') };
}
test('Driver popup/Offers rapid accept shares one frozen command and receipt keeps late PENDING locked', async t => {
  const f = await fixture(t); f.coordinator.decide('accept'); f.coordinator.decide('accept'); f.coordinator.decide('decline'); await flush();
  assert.equal(f.posts().length, 1); assert.deepEqual(f.posts()[0].body, {}); assert.ok(f.posts()[0].key); assert.match(f.posts()[0].path, /\/accept$/);
  f.decision.resolve({ offerId: ids.offer, status: 'ASSIGNMENT_PENDING', accepted: true }); await flush();
  assert.equal(f.coordinator.getSnapshot().data.status, 'PENDING'); assert.equal(f.coordinator.getSnapshot().phase, 'awaiting-assignment'); assert.equal(f.coordinator.getSnapshot().canDecide, false);
  f.coordinator.decide('accept'); await flush(); assert.equal(f.posts().length, 1);
  f.coordinator.observeActive({ data: { tripId: 'unrelated-trip', driverId: ids.driver, status: 'ASSIGNED' }, loading: false, error: null, checkedAt: Date.now() });
  assert.equal(f.coordinator.getSnapshot().phase, 'awaiting-assignment');
  f.coordinator.observeActive({ data: { tripId: ids.trip, driverId: ids.driver, status: 'ASSIGNED' }, loading: false, error: null, checkedAt: Date.now() });
  assert.equal(f.coordinator.getSnapshot().phase, 'confirmed');
});
test('Driver offer timeout and restart reconcile first, retry preserves endpoint/key/body/version', async t => {
  const f = await fixture(t); f.coordinator.decide('accept'); await flush(); f.decision.reject(new f.ApiError('TIMEOUT')); await flush();
  assert.equal(f.coordinator.getSnapshot().phase, 'uncertain'); assert.equal(f.coordinator.getSnapshot().canRetry, true);
  const original = f.posts()[0]; f.coordinator.stop();
  const { OfferCoordinator } = f.load('src/features/driver/state/offer-coordinator.ts'), { DriverMatchingClient } = f.load('src/features/driver/clients/matching-client.ts');
  const restored = new OfferCoordinator(new DriverMatchingClient(f.config, f.session), f.session, f.storage, f.config); t.after(() => restored.stop());
  restored.start(ids.driver, () => {}); restored.setForeground(true); await flush(); assert.equal(f.posts().length, 1); assert.equal(restored.getSnapshot().canRetry, true);
  restored.retry(); await flush(); assert.equal(f.posts().length, 2);
  for (const name of ['path', 'method', 'key']) assert.equal(f.posts()[1][name], original[name]); assert.deepEqual(f.posts()[1].body, original.body);
  const journal = [...f.storage.records.values()].filter(v => v?.startsWith('{')).map(JSON.parse).find(v => v.command); assert.equal(journal.command.version, 1);
});
test('Driver accepted receipt survives restart; active null/network error never implies assignment failure', async t => {
  const f = await fixture(t); f.coordinator.decide('accept'); await flush(); f.decision.resolve({ offerId: ids.offer, status: 'ASSIGNMENT_PENDING', accepted: true }); await flush();
  f.coordinator.stop(); f.coordinator.start(ids.driver, () => {}); f.coordinator.setForeground(true); await flush();
  f.coordinator.observeActive({ data: null, loading: false, error: Error('offline'), checkedAt: Date.now() });
  assert.equal(f.coordinator.getSnapshot().phase, 'awaiting-assignment'); assert.equal(f.coordinator.getSnapshot().canRetry, false); assert.equal(f.posts().length, 1);
  f.offer = { ...f.offer, version: 2, status: 'REJECTED' }; f.coordinator.refresh(); await flush(); assert.equal(f.coordinator.getSnapshot().phase, 'closed');
});
test('Driver decline tombstone prevents stale PENDING from becoming actionable after remount', async t => {
  const f = await fixture(t); f.coordinator.decide('decline'); await flush(); f.decision.resolve({ offerId: ids.offer, status: 'DECLINED', accepted: false }); await flush();
  assert.equal(f.coordinator.getSnapshot().phase, 'closed'); f.coordinator.stop(); f.coordinator.start(ids.driver, () => {}); f.coordinator.setForeground(true); await flush();
  assert.equal(f.coordinator.getSnapshot().phase, 'closed'); assert.equal(f.coordinator.getSnapshot().canDecide, false); assert.equal(f.posts().length, 1);
});
test('Driver storage failure sends nothing; owner change ignores delayed receipt and writes', async t => {
  const f = await fixture(t), write = f.storage.writeOfferState; f.storage.writeOfferState = async () => { throw new f.ApiError('STORAGE_UNAVAILABLE'); };
  f.coordinator.decide('accept'); await flush(); assert.equal(f.posts().length, 0); assert.ok(f.coordinator.getSnapshot().storageError);
  f.storage.writeOfferState = write; f.coordinator.refresh(); await flush(); f.coordinator.retry(); await flush(); assert.equal(f.posts().length, 1);
  f.session.change(ids.other); f.decision.resolve({ offerId: ids.offer, status: 'ASSIGNMENT_PENDING', accepted: true }); await flush();
  assert.equal(f.coordinator.getSnapshot().driverId, null); assert.notEqual(f.coordinator.getSnapshot().phase, 'confirmed');
  const journal = [...f.storage.records.values()].filter(v => v?.startsWith('{')).map(JSON.parse).find(v => v.command); assert.equal(journal.receipt, null);
});
test('Driver offer GET events coalesce; expiry disables decisions and conflict never rewrites version/key', async t => {
  const f = await fixture(t), pending = deferred(); let reads = 0;
  f.setRead(async () => { reads++; if (reads === 1) return pending.promise; return f.offer; });
  f.coordinator.refresh(); f.coordinator.refresh(); f.coordinator.refresh(); assert.equal(reads, 1); pending.resolve(f.offer); await flush(); assert.equal(reads, 2);
  f.coordinator.decide('accept'); await flush(); f.decision.reject(new f.ApiError('OFFER_CLOSED', 409)); await flush();
  assert.equal(f.coordinator.getSnapshot().canRetry, false); assert.equal(f.coordinator.getSnapshot().canDecide, false); f.coordinator.retry(); assert.equal(f.posts().length, 1);
  f.offer = { ...f.offer, status: 'EXPIRED', version: 2, expiresAt: new Date(Date.now() - 1).toISOString() }; f.coordinator.refresh(); await flush(); assert.equal(f.coordinator.getSnapshot().phase, 'closed');
});
