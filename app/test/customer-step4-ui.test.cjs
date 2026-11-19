const {test} = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), {act, create} = require('react-test-renderer');
const {loader, deferred, flush, ids} = require('./helpers/driver.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const host = name => {function Host(props) {return React.createElement(name, props, props.children);} Host.displayName = name; return Host;};
const ui = Object.fromEntries(['Action', 'Card', 'Field', 'Notice', 'Busy', 'Screen'].map(name => [name, host(name)]));
const boundaries = {'react-native': {View: host('View'), Switch: host('Switch'), Image: host('Image'), Text: host('Text')},
  '@/components/themed-text': {ThemedText: host('Text')}, 'src/features/ui/components.tsx': ui,
  'src/features/ui/design.tsx': {palette: {}, Chip: host('Chip'), vnd: value => `${value} ₫`}, 'src/features/map/ride-map.tsx': {RideMap: host('RideMap')}};
const button = (tree, label) => tree.root.findAllByType('Action').find(node => node.props.label === label);
const field = (tree, label) => tree.root.findAllByType('Field').find(node => node.props.label === label);
const profile = {id: ids.driver, fullName: 'Khách', phoneNumber: '+84912345678', avatarUrl: null, createdAt: '2026-01-01T00:00:00Z'};
const place = {id: ids.offer, label: 'Nhà', addressText: 'Địa chỉ gốc', lat: 21, lng: 105, isDefault: true};
function fixture(extra = {}) {
  let epoch = 1; const navigation = [], state = {session: {profile}};
  const runtime = {session: {getOwnerEpoch: () => epoch, getSnapshot: () => state, authorized: async work => work('test')}, user: {places: async () => [place]}};
  const load = loader({...boundaries, 'expo-router': {useFocusEffect: effect => React.useEffect(effect, [effect]), router: {canGoBack: () => false, back: () => navigation.push('back'), replace: value => navigation.push(value), navigate: value => navigation.push(value)}, useLocalSearchParams: () => ({id: ids.offer})},
    'src/features/customer/provider.tsx': {useCustomer: () => runtime, useCustomerSession: () => state}, ...extra});
  return {load, runtime, state, navigation, changeOwner: () => epoch++};
}

test('profile retains failed edits, maps fields safely, locks duplicate save and publishes acknowledged result', async t => {
  const f = fixture(), response = deferred(); let calls = 0, tree;
  f.runtime.session.saveProfile = async input => {calls++; if (calls === 1) return response.promise; return {...profile, ...input};};
  const {CustomerProfileForm} = f.load('src/features/customer/profile-form.tsx'), {BackendError} = f.load('src/features/backend/http.ts');
  await act(async () => {tree = create(React.createElement(CustomerProfileForm));}); t.after(async () => act(() => tree.unmount()));
  await act(async () => {field(tree, 'Họ tên').props.onChangeText('Tên chưa lưu'); field(tree, 'URL ảnh đại diện').props.onChangeText('http://example.test/image');});
  await act(async () => {const save = button(tree, 'Lưu hồ sơ').props.onPress; save(); save();}); assert.equal(calls, 1);
  await act(async () => {response.reject(new BackendError('VALIDATION_ERROR', 400, undefined, undefined, {avatarUrl: 'PRIVATE_STACK'})); await flush();});
  assert.equal(field(tree, 'Họ tên').props.value, 'Tên chưa lưu'); assert.ok(field(tree, 'URL ảnh đại diện').props.error); assert.doesNotMatch(JSON.stringify(tree.toJSON()), /PRIVATE_STACK/);
  await act(async () => {button(tree, 'Lưu hồ sơ').props.onPress(); await flush();}); assert.match(JSON.stringify(tree.toJSON()), /Hồ sơ đã được lưu/); assert.equal(calls, 2);
});

test('address editor uses a separate route/map, preserves failed draft and submits exact default/coordinates on retry', async t => {
  const f = fixture(), response = deferred(); let calls = 0, tree; const sent = [];
  const {CustomerDataProvider} = f.load('src/features/customer/data-provider.tsx'), {CustomerPlaceEditor} = f.load('src/features/customer/place-editor.tsx');
  f.runtime.user.updatePlace = async (_, id, input) => {calls++; sent.push({id, input}); if (calls === 1) return response.promise; return {...place, ...input};};
  await act(async () => {tree = create(React.createElement(CustomerDataProvider, null, React.createElement(CustomerPlaceEditor))); await flush();}); t.after(async () => act(() => tree.unmount()));
  assert.equal(tree.root.findByType('RideMap').props.candidate.lat, 21);
  await act(async () => {field(tree, 'Nhãn địa chỉ (tùy chọn)').props.onChangeText('Cơ quan'); field(tree, 'Địa chỉ').props.onChangeText('Địa chỉ mới'); tree.root.findByType('RideMap').props.onSelect({lat: 22, lng: 106});});
  await act(async () => {const save = button(tree, 'Lưu địa chỉ đã sửa').props.onPress; save(); save();}); assert.equal(calls, 1);
  await act(async () => {response.reject(Error('PRIVATE_NETWORK')); await flush();});
  assert.equal(field(tree, 'Địa chỉ').props.value, 'Địa chỉ mới'); assert.equal(field(tree, 'Vĩ độ địa chỉ').props.value, '22'); assert.equal(f.navigation.length, 0);
  await act(async () => {button(tree, 'Lưu địa chỉ đã sửa').props.onPress(); await flush();});
  assert.deepEqual(sent[1], {id: ids.offer, input: {label: 'Cơ quan', addressText: 'Địa chỉ mới', lat: 22, lng: 106, makeDefault: true}}); assert.deepEqual(f.navigation, ['/customer/account']);
});

test('new address map default is not confirmed; cancellation preserves draft and deletion requires explicit confirmation', async t => {
  const f = fixture(); let tree, deleted = 0; f.runtime.user.deletePlace = async () => {deleted++;};
  const {CustomerDataProvider} = f.load('src/features/customer/data-provider.tsx'), {CustomerPlaceEditor} = f.load('src/features/customer/place-editor.tsx'), {CustomerPlacesPanel} = f.load('src/features/customer/places-panel.tsx');
  await act(async () => {tree = create(React.createElement(CustomerDataProvider, null, React.createElement(CustomerPlaceEditor, {create: true})));});
  assert.equal(tree.root.findByType('RideMap').props.candidate, undefined);
  await act(async () => button(tree, 'Lưu địa chỉ mới').props.onPress()); assert.ok(field(tree, 'Vĩ độ địa chỉ').props.error);
  await act(async () => {field(tree, 'Địa chỉ').props.onChangeText('Chưa lưu'); button(tree, 'Quay lại tài khoản').props.onPress();});
  await act(async () => button(tree, 'Quay lại tài khoản').props.onPress()); assert.ok(button(tree, 'Tiếp tục chỉnh sửa'));
  await act(async () => button(tree, 'Tiếp tục chỉnh sửa').props.onPress()); assert.equal(field(tree, 'Địa chỉ').props.value, 'Chưa lưu');
  await act(async () => tree.unmount());
  await act(async () => {tree = create(React.createElement(CustomerDataProvider, null, React.createElement(CustomerPlacesPanel, {select: () => {}}))); await flush();}); t.after(async () => act(() => tree.unmount()));
  await act(async () => button(tree, 'Xóa địa chỉ').props.onPress()); assert.equal(deleted, 0);
  await act(async () => button(tree, 'Giữ địa chỉ').props.onPress()); assert.equal(deleted, 0);
  await act(async () => button(tree, 'Xóa địa chỉ').props.onPress());
  await act(async () => {const remove = button(tree, 'Xác nhận xóa địa chỉ').props.onPress; remove(); remove(); await flush();}); assert.equal(deleted, 1);
});

test('security validates confirmation, hides passwords and leaves failed inputs available for correction', async t => {
  const f = fixture(); let calls = 0, tree; f.runtime.session.changePassword = async () => {calls++; throw Error('PRIVATE_ERROR');};
  const {CustomerSecurityForm} = f.load('src/features/customer/security-form.tsx');
  await act(async () => {tree = create(React.createElement(CustomerSecurityForm));}); t.after(async () => act(() => tree.unmount()));
  await act(async () => {field(tree, 'Mật khẩu hiện tại').props.onChangeText('OldPass123'); field(tree, 'Mật khẩu mới').props.onChangeText('NewPass123'); field(tree, 'Xác nhận mật khẩu mới').props.onChangeText('bad');});
  await act(async () => button(tree, 'Lưu mật khẩu và đăng nhập lại').props.onPress()); assert.equal(calls, 0); assert.ok(field(tree, 'Xác nhận mật khẩu mới').props.error); assert.equal(field(tree, 'Mật khẩu mới').props.secureTextEntry, true);
  await act(async () => {field(tree, 'Xác nhận mật khẩu mới').props.onChangeText('NewPass123'); button(tree, 'Hiện mật khẩu').props.onPress();});
  await act(async () => {button(tree, 'Lưu mật khẩu và đăng nhập lại').props.onPress(); await flush();}); assert.equal(calls, 1); assert.equal(field(tree, 'Mật khẩu mới').props.value, 'NewPass123'); assert.doesNotMatch(JSON.stringify(tree.toJSON()), /PRIVATE_ERROR/);
});

test('avatar falls back after image failure and can display a different URL later', async t => {
  const f = fixture(), {Avatar} = f.load('src/features/ui/avatar.tsx'); let tree;
  await act(async () => {tree = create(React.createElement(Avatar, {name: 'Nguyễn An', url: 'https://example.test/bad'}));}); t.after(async () => act(() => tree.unmount()));
  await act(async () => tree.root.findByType('Image').props.onError()); assert.equal(tree.root.findAllByType('Image').length, 0); assert.match(JSON.stringify(tree.toJSON()), /NA/);
  await act(async () => tree.update(React.createElement(Avatar, {name: 'Nguyễn An', url: 'http://example.test/new'}))); assert.equal(tree.root.findByType('Image').props.source.uri, 'http://example.test/new');
});

test('late save after account change or unmount cannot show success or navigate', async t => {
  const f = fixture(), response = deferred(); let tree; f.runtime.session.saveProfile = () => response.promise;
  const {CustomerProfileForm} = f.load('src/features/customer/profile-form.tsx');
  await act(async () => {tree = create(React.createElement(CustomerProfileForm));}); t.after(async () => act(() => tree.unmount()));
  await act(async () => button(tree, 'Lưu hồ sơ').props.onPress()); f.changeOwner();
  await act(async () => {response.resolve({...profile, fullName: 'Không được hiện'}); await flush();}); assert.doesNotMatch(JSON.stringify(tree.toJSON()), /Không được hiện|Hồ sơ đã được lưu/);
});

test('detail fetches its ID, displays actual timeline/cost and handles 404 without inventing milestones', async t => {
  const f = fixture({'expo-router': {useLocalSearchParams: () => ({id: ids.trip}), router: {canGoBack: () => false, replace: () => {}}}, 'src/features/ui/trip-card.tsx': {TripCard: host('TripCard'), tripLabels: {COMPLETED: 'Hoàn thành'}}, 'src/features/customer/rebook-action.tsx': {RebookAction: host('RebookAction')}});
  const response = deferred(); let tree, requested;
  f.runtime.trips = {detail: async (_, id) => {requested = id; return response.promise;}};
  const {CustomerTripDetail} = f.load('src/features/customer/trip-detail.tsx'), {BackendError} = f.load('src/features/backend/http.ts');
  await act(async () => {tree = create(React.createElement(CustomerTripDetail));}); t.after(async () => act(() => tree.unmount())); assert.equal(requested, ids.trip);
  await act(async () => {response.reject(new BackendError('NOT_FOUND', 404)); await flush();}); assert.match(JSON.stringify(tree.toJSON()), /không tồn tại hoặc bạn không được xem/);
  const trip = {tripId: ids.trip, driverId: null, vehicleId: null, status: 'COMPLETED', version: 6, pickup: {lat: 21, lng: 105}, destination: {lat: 22, lng: 106}, vehicleType: 'CAR_4', route: {distanceMeters: 2500, durationSeconds: 300}, fare: {currency: 'VND', estimatedAmount: '9007199254740993', finalAmount: null, breakdown: [{code: 'BASE_FARE', amount: '9007199254740993'}]}};
  f.runtime.trips.detail = async () => ({data: {trip, statusHistory: [{fromStatus: 'IN_PROGRESS', toStatus: 'COMPLETED', actorType: 'DRIVER', occurredAt: '2026-11-18T01:02:03Z', version: 6}]}});
  await act(async () => {button(tree, 'Thử tải lại chi tiết').props.onPress(); await flush();});
  const text = JSON.stringify(tree.toJSON()); assert.match(text, /Giá mở cửa/); assert.match(text, /9007199254740993/); assert.match(text, /Hoàn thành/); assert.doesNotMatch(text, /Đã đến điểm đón|Bắt đầu chuyến|đã thanh toán/i); assert.equal(tree.root.findByType('RebookAction').props.trip.tripId, ids.trip);
});

test('history UI distinguishes unknown/error from empty and retries the failed next page', async t => {
  let snapshot = {history: {items: [], loaded: false, loading: false, error: 'Mất mạng', filter: 'COMPLETED', cursor: null, failedMore: false}}, tree; const calls = [];
  const store = {getSnapshot: () => snapshot, loadHistory: async more => {calls.push(more);}, setHistoryFilter: value => calls.push(value)};
  const f = fixture({'src/features/customer/booking-provider.tsx': {useBooking: () => ({store, state: snapshot})}, 'src/features/customer/history-card.tsx': {CustomerHistoryCard: host('HistoryCard')}}), {CustomerHistory} = f.load('src/features/customer/history.tsx');
  await act(async () => {tree = create(React.createElement(CustomerHistory));}); t.after(async () => act(() => tree.unmount())); assert.doesNotMatch(JSON.stringify(tree.toJSON()), /Bạn chưa có chuyến/);
  snapshot = {history: {...snapshot.history, items: [{tripId: ids.trip}], loaded: true, cursor: 'next', failedMore: true}};
  await act(async () => tree.update(React.createElement(CustomerHistory))); assert.equal(tree.root.findAllByType('HistoryCard').length, 1);
  await act(async () => button(tree, 'Thử tải thêm lần nữa').props.onPress()); assert.equal(calls.at(-1), true);
  await act(async () => button(tree, 'Đã hủy').props.onPress()); assert.equal(calls.at(-1), 'CANCELLED');
});

test('revisiting history reads the server even after an earlier empty result', async () => {
  let focused, requests = 0, tree;
  const snapshot = {history: {items: [], loaded: true, loading: false, error: null, filter: 'ALL', cursor: null}};
  const store = {loadHistory: async () => {requests++;}, setHistoryFilter: () => {}};
  const f = fixture({'expo-router': {useFocusEffect: effect => {focused = effect;}},
    'src/features/customer/booking-provider.tsx': {useBooking: () => ({store, state: snapshot})},
    'src/features/customer/history-card.tsx': {CustomerHistoryCard: host('HistoryCard')}});
  const {CustomerHistory} = f.load('src/features/customer/history.tsx');
  await act(async () => {tree = create(React.createElement(CustomerHistory));});
  await act(async () => focused());
  assert.equal(requests, 1);
  // A trip ends while another tab is open; the cached empty page is not authoritative.
  await act(async () => {focused(); snapshot.history.items = [{tripId: ids.trip}]; tree.update(React.createElement(CustomerHistory));});
  assert.equal(requests, 2); assert.equal(tree.root.findAllByType('HistoryCard').length, 1);
  await act(async () => tree.unmount());
});
