const {test} = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), {act, create} = require('react-test-renderer');
const {loader, flush, ids} = require('./helpers/driver.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const host = name => {function Host(props) {return React.createElement(name, props, props.children);} Host.displayName = name; return Host;};
const ui = Object.fromEntries(['Action', 'Busy', 'Card', 'Field', 'Notice', 'Screen'].map(name => [name, host(name)]));
const trip = (patch = {}) => ({tripId: ids.trip, driverId: null, vehicleId: null, status: 'SEARCHING', version: 1, pickup: {lat: 21, lng: 105}, destination: {lat: 21.02, lng: 105.03}, vehicleType: 'CAR_4', fare: {currency: 'VND', estimatedAmount: '9007199254740993', finalAmount: null}, ...patch});
const action = (tree, label) => tree.root.findAllByType('Action').find(node => node.props.label === label);
function fixture(options = {}) {
  let store, active = options.trip ?? null, actual = active; const navigated = []; let cancellations = 0;
  const load = loader({
    'react-native': {View: host('View'), Text: host('Text'), Image: host('Image'), Pressable: host('Pressable'), StyleSheet: {create: value => value}},
    '@expo/vector-icons': {Ionicons: host('Icon')}, '@/components/themed-text': {ThemedText: host('Text')},
    'expo-router': {router: {push: value => navigated.push(value)}},
    'src/features/ui/components.tsx': ui, 'src/features/customer/booking-form.tsx': {BookingForm: host('BookingForm')},
    'src/features/customer/booking-provider.tsx': {useBooking: () => {
      const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot), command = React.useSyncExternalStore(store.commands.subscribe, store.commands.getSnapshot);
      return {store, state, command, locked: store.draftLocked};
    }},
  });
  const {CustomerBookingStore} = load('src/features/customer/booking-store.ts'), {DurableCommand} = load('src/features/backend/durable-command.ts'), {BackendError} = load('src/features/backend/http.ts');
  const runtime = {session: {getOwnerEpoch: () => 1, authorized: work => work('token')}, trips: {
    active: async () => ({data: active}), detail: async () => ({data: {trip: actual, statusHistory: []}}),
    cancel: async () => {cancellations++; actual = trip({status: 'CANCELLED', version: 4}); active = null; return {data: actual};},
  }};
  store = new CustomerBookingStore(runtime, new DurableCommand({read: async () => options.pending ?? null, write: async () => {}}));
  const stop = store.start(); return {load, store, runtime, stop, navigated, BackendError, cancellations: () => cancellations, change: value => {active = value; actual = value;}, terminal: value => {active = null; actual = value;}};
}

test('Customer renders each real Trip state with appropriate actions, real snapshots and missing-field fallbacks', async t => {
  const f = fixture(); t.after(f.stop); await flush();
  const {ActiveTripCard} = f.load('src/features/customer/active-trip-card.tsx'), {customerTripStates} = f.load('src/features/customer/trip-policy.ts'); let tree;
  await act(async () => {tree = create(React.createElement(ActiveTripCard));}); t.after(async () => act(() => tree.unmount()));
  let version = 1;
  for (const status of ['CREATED', 'SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']) {
    const value = trip({status, version: version++, ...(status === 'ASSIGNED' ? {driver: {fullName: 'Tài xế từ API', avatarUrl: null}, vehicle: {licensePlate: '30A-TEST', brand: 'Nhãn xe từ API', color: 'Đen'}} : {})});
    // Cancellation uses a second Trip so a completed Trip is never resurrected.
    value.tripId = status === 'CANCELLED' ? ids.offer : ids.trip;
    await act(async () => {if (['COMPLETED', 'CANCELLED'].includes(status)) f.terminal(value); else f.change(value); await f.store.refresh();});
    if (status === 'CANCELLED') {await act(async () => {f.change(value); await f.store.refresh();});}
    const rendered = JSON.stringify(tree.toJSON()); assert.ok(rendered.includes(customerTripStates[status].title));
    assert.doesNotMatch(rendered, /ETA|đến đón sau|đã thanh toán|Call Driver|Message|4812/);
    assert.equal(!!action(tree, 'Hủy chuyến · không mất phí'), ['CREATED', 'SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED'].includes(status));
    if (status === 'ASSIGNED') {assert.match(rendered, /Tài xế từ API/); assert.match(rendered, /30A-TEST/); assert.match(rendered, /Nhãn xe từ API/);}
    if (status === 'DRIVER_ARRIVED') {assert.match(rendered, /Thông tin tài xế đang được cập nhật/); assert.match(rendered, /Chưa có thông tin/);}
  }
  await act(async () => action(tree, 'Xem chi tiết chuyến').props.onPress()); assert.equal(f.navigated[0].pathname, '/customer/trips/[id]');
});

test('Customer lifecycle keeps last Trip during lost REST/socket connection; no booking form or actionable cancellation', async t => {
  const f = fixture({trip: trip({status: 'ASSIGNED', version: 2})}); t.after(f.stop); await flush();
  const {CustomerTripLifecycle} = f.load('src/features/customer/trip-lifecycle.tsx'); let tree;
  await act(async () => {tree = create(React.createElement(CustomerTripLifecycle, {now: Date.now()}));}); t.after(async () => act(() => tree.unmount()));
  f.runtime.trips.active = async () => {throw new f.BackendError('NETWORK_ERROR');};
  await act(async () => {f.store.setConnection('retrying'); await f.store.refresh();});
  assert.equal(tree.root.findAllByType('BookingForm').length, 0); assert.equal(action(tree, 'Hủy chuyến · không mất phí').props.disabled, true);
  assert.match(JSON.stringify(tree.toJSON()), /Thông tin chuyến gần nhất vẫn được giữ/); assert.ok(action(tree, 'Thử kiểm tra lại'));
  await act(async () => f.store.setForeground(false)); assert.equal(action(tree, 'Thử kiểm tra lại').props.disabled, true);
});

test('Customer cancellation UI requires confirmation, locks double submit and ends in summary before a new booking', async t => {
  const f = fixture({trip: trip({status: 'DRIVER_ARRIVED', version: 3})}); t.after(f.stop); await flush();
  const {CustomerTripLifecycle} = f.load('src/features/customer/trip-lifecycle.tsx'); let tree;
  await act(async () => {tree = create(React.createElement(CustomerTripLifecycle, {now: Date.now()}));}); t.after(async () => act(() => tree.unmount()));
  await act(async () => action(tree, 'Hủy chuyến · không mất phí').props.onPress()); assert.equal(f.cancellations(), 0); assert.ok(action(tree, 'Xác nhận hủy chuyến'));
  await act(async () => action(tree, 'Giữ chuyến đi').props.onPress()); assert.equal(action(tree, 'Xác nhận hủy chuyến'), undefined);
  await act(async () => action(tree, 'Hủy chuyến · không mất phí').props.onPress());
  await act(async () => {const send = action(tree, 'Xác nhận hủy chuyến').props.onPress; send(); send(); await flush();});
  assert.equal(f.cancellations(), 1); assert.match(JSON.stringify(tree.toJSON()), /Chuyến đi đã hủy/); assert.ok(action(tree, 'Đặt chuyến mới')); assert.equal(tree.root.findAllByType('BookingForm').length, 0);
  await act(async () => {action(tree, 'Đặt chuyến mới').props.onPress(); await flush();}); assert.equal(tree.root.findAllByType('BookingForm').length, 1);
});

test('Customer pending create has clear recovery action and never displays a fresh booking form', async t => {
  const pending = {operation: 'create', key: ids.other, body: {quoteId: ids.offer}}, f = fixture({pending}); t.after(f.stop); await flush();
  const {CustomerTripLifecycle} = f.load('src/features/customer/trip-lifecycle.tsx'); let tree;
  await act(async () => {tree = create(React.createElement(CustomerTripLifecycle, {now: Date.now()}));}); t.after(async () => act(() => tree.unmount()));
  assert.equal(tree.root.findAllByType('BookingForm').length, 0); assert.match(JSON.stringify(tree.toJSON()), /Yêu cầu đặt xe chưa rõ kết quả/); assert.ok(action(tree, 'Kiểm tra và thử lại yêu cầu đã lưu'));
});

test('Customer terminal summary cannot start a new booking until current state has been reverified', async t => {
  const f = fixture({trip: trip({status: 'IN_PROGRESS', version: 4})}); t.after(f.stop); await flush();
  f.terminal(trip({status: 'COMPLETED', version: 5, fare: {currency: 'VND', estimatedAmount: '9007199254740993', finalAmount: '9007199254740993'}})); await f.store.refresh();
  const {CustomerTripLifecycle} = f.load('src/features/customer/trip-lifecycle.tsx'); let tree;
  await act(async () => {tree = create(React.createElement(CustomerTripLifecycle, {now: Date.now()}));}); t.after(async () => act(() => tree.unmount()));
  assert.match(JSON.stringify(tree.toJSON()), /Giá chốt chuyến đi/); assert.equal(action(tree, 'Đặt chuyến mới').props.disabled, false);
  await act(async () => {f.runtime.trips.active = async () => {throw new f.BackendError('TIMEOUT');}; await f.store.refresh();});
  assert.equal(action(tree, 'Đặt chuyến mới').props.disabled, true); assert.match(JSON.stringify(tree.toJSON()), /Hành trình đã hoàn thành/);
});

test('Customer authenticated shell polls foreground only and drains one fresh read after resume; unmount clears poll/subscriptions', async t => {
  t.mock.timers.enable({apis: ['setInterval']});
  let foreground = true, state = {restoring: false, session: {profile: {id: ids.driver}}}, tree;
  const listeners = new Set(), eventListeners = new Set(), connectionListeners = new Set(); let activeReads = 0;
  const session = {getOwnerEpoch: () => 1, getSnapshot: () => state, subscribe: fn => {listeners.add(fn); return () => listeners.delete(fn);}, authorized: work => work('token')};
  const runtime = {base: 'https://test.invalid', session, trips: {active: async () => {activeReads++; return {data: null};}}, events: {
    subscribe: fn => {eventListeners.add(fn); return () => eventListeners.delete(fn);}, getConnectionSnapshot: () => 'connected', subscribeConnection: fn => {connectionListeners.add(fn); return () => connectionListeners.delete(fn);},
  }};
  const load = loader({'expo-router': {Redirect: host('Redirect')}, 'src/features/ui/components.tsx': ui,
    'src/features/customer/provider.tsx': {useCustomer: () => runtime, useCustomerSession: () => React.useSyncExternalStore(session.subscribe, session.getSnapshot)},
    'src/features/ui/use-foreground.ts': {useForeground: () => foreground},
  });
  const {CustomerSessionGate} = load('src/features/customer/booking-provider.tsx');
  const render = () => React.createElement(CustomerSessionGate, null, React.createElement('Route'));
  await act(async () => {tree = create(render()); await flush();}); t.after(async () => {if(tree)await act(() => tree.unmount());});
  assert.equal(activeReads, 1); assert.equal(eventListeners.size, 1); assert.equal(connectionListeners.size, 1);
  await act(async () => {tree.update(render()); t.mock.timers.tick(5000); await flush();}); assert.equal(activeReads, 2);
  await act(async () => {foreground = false; tree.update(render());}); const before = activeReads;
  await act(async () => {t.mock.timers.tick(15000); for(const event of eventListeners)event(); await flush();}); assert.equal(activeReads, before);
  await act(async () => {foreground = true; tree.update(render()); await flush();}); assert.equal(activeReads, before + 1);
  await act(async () => tree.unmount()); tree = null; assert.equal(eventListeners.size, 0); assert.equal(connectionListeners.size, 0);
  const stopped = activeReads; t.mock.timers.tick(15000); await flush(); assert.equal(activeReads, stopped);
});
