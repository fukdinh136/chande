const {test} = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), {act, create} = require('react-test-renderer');
const {loader, deferred, flush, ids} = require('./helpers/driver.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const host = name => {function Host(props) {return React.createElement(name, props, props.children);} Host.displayName = name; return Host;};
const ui = Object.fromEntries(['Action', 'Busy', 'Field', 'Notice'].map(name => [name, host(name)]));
const boundaries = {'react-native': {View: host('View'), Text: host('Text'), Pressable: host('Pressable'), StyleSheet: {create: value => value}},
  '@expo/vector-icons': {Ionicons: host('Icon')}, '@/components/themed-text': {ThemedText: host('Text')},
  'src/features/ui/components.tsx': ui,
};
const button = (tree, label) => tree.root.findAllByType('Action').find(node => node.props.label === label);
function fixture(extra = {}) {
  let store, runtime, created = 0;
  function useBooking() {
    const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot), command = React.useSyncExternalStore(store.commands.subscribe, store.commands.getSnapshot);
    return {store, state, command, locked: store.draftLocked};
  }
  const load = loader({...boundaries, 'expo-router': {router: {navigate: () => {}}}, 'src/features/customer/booking-provider.tsx': {useBooking},
    'src/features/customer/provider.tsx': {useCustomer: () => runtime},
    'src/features/customer/current-location.ts': {currentLocation: async () => ({lat: 21, lng: 105})},
    ...extra,
  });
  const {CustomerBookingStore} = load('src/features/customer/booking-store.ts'), {DurableCommand} = load('src/features/backend/durable-command.ts');
  const pickup = {lat: 21, lng: 105}, destination = {lat: 21.02, lng: 105.03};
  let active = null;
  runtime = {session: {getOwnerEpoch: () => 1, authorized: work => work('test')}, user: {places: async () => []},
    trips: {active: async () => ({data: active}), estimate: async () => ({data: {quoteId: ids.offer, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300000).toISOString(), fare: {currency: 'VND', amount: '9007199254740993'}, route: {distanceMeters: 2546, durationSeconds: 600}}, serverDate: Date.now()}),
      create: async () => {created++; active = {tripId: ids.trip, driverId: null, vehicleId: null, version: 1, status: 'SEARCHING', pickup, destination, vehicleType: 'CAR_7', fare: {currency: 'VND', estimatedAmount: '9007199254740993', finalAmount: null}}; return {data: active};}},
    routes: {route: async () => ({data: {polyline: {encoding: 'encoded_polyline', precision: 6, value: '???_ibE'}}})},
  };
  store = new CustomerBookingStore(runtime, new DurableCommand({read: async () => null, write: async () => {}}));
  const stop = store.start(); return {load, store, runtime, stop, pickup, destination, created: () => created};
}

test('Customer form presents four steps, exact VND and journey metrics; final CTA alone creates', async t => {
  const f = fixture({'src/features/customer/point-picker.tsx': {PointPicker: host('PointPicker')}}); t.after(f.stop); await flush();
  const {BookingForm} = f.load('src/features/customer/booking-form.tsx'); let tree;
  await act(async () => {tree = create(React.createElement(BookingForm, {now: Date.now()}));}); t.after(async () => act(() => tree.unmount()));
  assert.equal(button(tree, 'Tiếp tục chọn xe'), undefined); assert.equal(f.created(), 0);
  await act(async () => {f.store.proposePoint(f.pickup); f.store.confirmPoint(); f.store.proposePoint(f.destination); f.store.confirmPoint();});
  await act(async () => button(tree, 'Tiếp tục chọn xe').props.onPress());
  await act(async () => tree.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === 'Ô tô 7 chỗ').props.onPress());
  await act(async () => {button(tree, 'Xem giá chuyến đi').props.onPress(); await flush();});
  const rendered = JSON.stringify(tree.toJSON()); assert.match(rendered, /9\.007\.199\.254\.740\.993 ₫/); assert.match(rendered, /Thời gian hành trình/); assert.doesNotMatch(rendered, /ETA|đến đón/);
  assert.equal(button(tree, 'Xác nhận đặt xe'), undefined); assert.equal(f.created(), 0);
  await act(async () => button(tree, 'Tiếp tục xác nhận').props.onPress());
  await act(async () => {const confirm = button(tree, 'Xác nhận đặt xe').props.onPress; confirm(); confirm(); await flush();});
  assert.equal(f.created(), 1);
});

test('Customer expired quote exposes renewal and no actionable confirmation', async t => {
  const f = fixture({'src/features/customer/point-picker.tsx': {PointPicker: host('PointPicker')}}); t.after(f.stop); await flush();
  f.store.setPoint('pickup', f.pickup); f.store.setPoint('destination', f.destination); await f.store.estimate(); f.store.goTo('confirm');
  const {BookingForm} = f.load('src/features/customer/booking-form.tsx'); let tree;
  await act(async () => {tree = create(React.createElement(BookingForm, {now: Date.now() + 301000}));}); t.after(async () => act(() => tree.unmount()));
  assert.ok(button(tree, 'Lấy giá mới')); assert.equal(button(tree, 'Xác nhận đặt xe'), undefined); assert.equal(f.created(), 0);
});

test('Customer point picker does not ask GPS on mount; coordinate editing cancels late location and needs explicit confirmation', async t => {
  const wait = deferred(); let fixes = 0;
  const f = fixture({'src/features/customer/current-location.ts': {currentLocation: () => {fixes++; return wait.promise;}}}); t.after(f.stop); await flush();
  const {PointPicker} = f.load('src/features/customer/point-picker.tsx'); let tree;
  await act(async () => {tree = create(React.createElement(PointPicker));}); t.after(async () => act(() => tree.unmount()));
  assert.equal(fixes, 0); assert.equal(button(tree, 'Xác nhận điểm đón').props.disabled, true);
  await act(async () => button(tree, 'Vị trí hiện tại').props.onPress()); assert.equal(fixes, 1);
  await act(async () => button(tree, 'Xem / nhập tọa độ').props.onPress());
  await act(async () => {const fields = tree.root.findAllByType('Field'); fields[0].props.onChangeText('21,1'); fields[1].props.onChangeText('105,2');});
  await act(async () => button(tree, 'Đặt pin theo tọa độ').props.onPress());
  await act(async () => {wait.resolve({lat: 22, lng: 106}); await flush();});
  assert.deepEqual(f.store.getSnapshot().candidate.point, {lat: 21.1, lng: 105.2}); assert.equal(f.store.getSnapshot().draft.pickup, null);
  await act(async () => button(tree, 'Xác nhận điểm đón').props.onPress()); assert.deepEqual(f.store.getSnapshot().draft.pickup, {lat: 21.1, lng: 105.2});
});

test('Customer saved place shows its stored label, stages the choice and ignores results after unmount', async t => {
  const f = fixture(); t.after(f.stop); await flush();
  f.runtime.user.places = async () => [{id: ids.offer, label: 'Nhà', addressText: 'Địa chỉ từ tài khoản', ...f.pickup, isDefault: true}];
  const {SavedPlaces} = f.load('src/features/customer/saved-places.tsx'), {CustomerDataProvider} = f.load('src/features/customer/data-provider.tsx'); let tree;
  const render = () => React.createElement(CustomerDataProvider, null, React.createElement(SavedPlaces));
  await act(async () => {tree = create(render()); await flush();}); t.after(async () => {if (tree) await act(() => tree.unmount());});
  await act(async () => button(tree, 'Nhà · Mặc định · Địa chỉ từ tài khoản').props.onPress());
  assert.equal(f.store.getSnapshot().candidate.label, 'Nhà'); assert.equal(f.store.getSnapshot().draft.pickup, null);
  await act(async () => tree.unmount()); tree = null;
  const pending = deferred(); f.runtime.user.places = () => pending.promise;
  await act(async () => {tree = create(render());}); await act(async () => tree.unmount()); tree = null;
  await act(async () => {pending.reject(Error('PRIVATE_STACK')); await flush();}); assert.equal(f.store.getSnapshot().draft.pickup, null);
});

test('Customer sheet keeps two bounded sizes with large fonts/keyboard and restricts pan to the handle', async t => {
  let fontScale = 2, tree, expanded = false, shared = [];
  const pan = () => {const callbacks = {}; const gesture = {callbacks}; for (const name of ['activeOffsetY', 'failOffsetX', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) gesture[name] = value => {callbacks[name] = value; return gesture;}; return gesture;};
  const load = loader({...boundaries,
    'react-native': {...boundaries['react-native'], ScrollView: host('ScrollView'), useWindowDimensions: () => ({fontScale})},
    'react-native-gesture-handler': {Gesture: {Pan: pan}, GestureDetector: host('GestureDetector')},
    'react-native-worklets': {scheduleOnRN: (fn, ...args) => fn(...args)},
    'react-native-reanimated': {__esModule: true, default: {View: host('AnimatedView')}, withTiming: value => value,
      useAnimatedStyle: callback => callback(), useSharedValue: initial => {const ref = React.useRef(null); if (!ref.current) {let value = initial; ref.current = {get: () => value, set: next => {value = next;}}; shared.push(ref.current);} return ref.current;}},
  });
  const {BookingSheet} = load('src/features/customer/booking-sheet.tsx'), {sheetSizes} = load('src/features/customer/booking-policy.ts');
  const props = {availableHeight: 500, expanded, onExpanded: value => {expanded = value;}};
  await act(async () => {tree = create(React.createElement(BookingSheet, props, React.createElement('Content')));}); t.after(async () => act(() => tree.unmount()));
  const gesture = tree.root.findByType('GestureDetector'); assert.equal(gesture.findAllByType('ScrollView').length, 0);
  assert.equal(tree.root.findByType('ScrollView').props.nestedScrollEnabled, true);
  let events = gesture.props.gesture.callbacks; const sizes = sheetSizes(500, 2);
  assert.equal(shared[0].get(), sizes.collapsed); events.onStart(); events.onUpdate({translationY: -10000}); events.onEnd({velocityY: 0}); assert.equal(expanded, true);
  await act(async () => tree.update(React.createElement(BookingSheet, {...props, expanded}, React.createElement('Content'))));
  assert.equal(shared[0].get(), sizes.expanded); assert.equal(tree.root.findByType('Pressable').props.accessibilityState.expanded, true);
  fontScale = 3;
  await act(async () => tree.update(React.createElement(BookingSheet, {...props, availableHeight: 220, expanded}, React.createElement('Content'))));
  const small = sheetSizes(220, 3); assert.ok(small.collapsed < small.expanded && small.expanded < 220); assert.equal(shared[0].get(), small.expanded);
  events = tree.root.findByType('GestureDetector').props.gesture.callbacks; events.onStart(); events.onUpdate({translationY: 10000}); events.onEnd({velocityY: 0}); assert.equal(expanded, false);
});

test('Customer map retry retains confirmed/candidate markers and does not commit a map tap', async t => {
  let log;
  const moves = [], selected = [], camera = {fitBounds: (...args) => moves.push(args), easeTo: () => {}, flyTo: () => {}};
  const Camera = React.forwardRef((_, ref) => {React.useImperativeHandle(ref, () => camera); return null;}); Camera.displayName = 'Camera';
  const load = loader({...boundaries, 'react-native': {...boundaries['react-native'], Text: host('Text')},
    'src/features/ui/design.tsx': {palette: {}},
    '@maplibre/maplibre-react-native': {Map: host('Map'), Camera, Marker: host('Marker'), GeoJSONSource: host('Source'), Layer: host('Layer'), LogManager: {onLog: handler => {log = handler;}}},
  });
  const {RideMap} = load('src/features/map/ride-map.tsx'); let tree;
  const props = {reportTileErrors: true, fill: true, fitKey: 'customer/points', pickup: {lat: 21, lng: 105}, candidate: {lat: 22, lng: 106}, candidateKind: 'destination', onSelect: point => selected.push(point)};
  await act(async () => {tree = create(React.createElement(RideMap, props));}); t.after(async () => act(() => tree.unmount()));
  await act(async () => tree.root.findAllByType('View')[0].props.onLayout({nativeEvent: {layout: {width: 300, height: 80}}}));
  await act(async () => tree.root.findByType('Map').props.onDidFinishLoadingMap()); assert.equal(moves.length, 1);
  assert.ok(moves[0][1].padding.top + moves[0][1].padding.bottom < 80);
  await act(async () => {assert.equal(log({level: 'error', message: 'Failed to load tile 14/13009/7212 PRIVATE_DETAIL'}), true); tree.root.findByType('Map').props.onDidFinishLoadingMap();});
  assert.match(JSON.stringify(tree.toJSON()), /Bản đồ chưa tải được/); assert.doesNotMatch(JSON.stringify(tree.toJSON()), /PRIVATE_DETAIL/);
  assert.equal(log({level: 'error', message: 'Unexpected native failure'}), false);
  await act(async () => tree.root.findByType('Map').props.onDidFailLoadingMap());
  await act(async () => tree.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === 'Thử tải lại bản đồ').props.onPress());
  assert.deepEqual(tree.root.findAllByType('Marker').map(node => node.props.lngLat), [[105, 21], [106, 22]]); assert.equal(selected.length, 0);
  await act(async () => tree.root.findByType('Map').props.onPress({nativeEvent: {lngLat: [105.1, 21.1]}})); assert.deepEqual(selected, [{lat: 21.1, lng: 105.1}]);
  await act(async () => tree.unmount());
  assert.equal(log({level: 'error', message: 'Failed to load tile 14/13009/7212'}), false);
});
