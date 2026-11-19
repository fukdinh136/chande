const {test} = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), {act, create} = require('react-test-renderer');
const {loader, flush, deferred, ids} = require('./helpers/driver.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const host = name => {function TestHost(props) {return React.createElement(name, props, props.children);} TestHost.displayName = name; return TestHost;};
const ui = Object.fromEntries(['Screen', 'Action', 'Busy', 'Card', 'Field', 'Notice'].map(name => [name, host(name)]));
const native = {View: host('View'), Pressable: host('Pressable'), StyleSheet: {create: value => value}};
const boundaries = {
  'react-native': native, '@expo/vector-icons': {Ionicons: host('Icon')},
  '@/components/themed-text': {ThemedText: host('Text')},
  'src/features/ui/components.tsx': ui, 'src/features/ui/design.tsx': {palette: {}},
  'src/features/backend/connection.tsx': {ConnectionSettings: host('ConnectionSettings')},
};
function findField(tree, name) {return tree.root.findAllByType('Field').find(node => node.props.label === name);}

test('Customer login validates fields, toggles password, maps server errors and locks rapid submits', async t => {
  const pending = deferred(); let calls = 0, tree;
  const load = loader({...boundaries, 'expo-router': {Redirect: host('Redirect')},
    'src/features/customer/provider.tsx': {useCustomer: () => ({session: {getOwnerEpoch: () => 1, login: async () => {calls++; return pending.promise;}}}), useCustomerSession: () => ({restoring: false, session: null})},
  });
  const {BackendError} = load('src/features/backend/http.ts'), {CustomerLogin} = load('src/features/customer/login.tsx');
  await act(async () => {tree = create(React.createElement(CustomerLogin));}); t.after(async () => act(() => tree.unmount()));
  const submit = () => tree.root.findAllByType('Action').find(node => node.props.label === 'Đăng nhập').props.onPress;
  await act(async () => submit()()); assert.ok(findField(tree, 'Số điện thoại').props.error); assert.equal(calls, 0);
  await act(async () => {findField(tree, 'Số điện thoại').props.onChangeText('0912345678'); findField(tree, 'Mật khẩu').props.onChangeText('x');});
  assert.equal(findField(tree, 'Số điện thoại').props.keyboardType, 'phone-pad'); assert.equal(findField(tree, 'Mật khẩu').props.secureTextEntry, true);
  await act(async () => tree.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === 'Hiện mật khẩu').props.onPress());
  assert.equal(findField(tree, 'Mật khẩu').props.secureTextEntry, false);
  await act(async () => {const send = submit(); send(); send(); await flush();}); assert.equal(calls, 1); assert.equal(findField(tree, 'Mật khẩu').props.editable, false);
  await act(async () => {pending.reject(new BackendError('VALIDATION_ERROR', 400, undefined, undefined, {phoneNumber: 'PRIVATE_TECH_ERROR'})); await flush();});
  assert.ok(findField(tree, 'Số điện thoại').props.error); assert.doesNotMatch(JSON.stringify(tree.toJSON()), /PRIVATE_TECH_ERROR/);
});

test('Customer register sends contract fields once and then uses the existing UserSession login', async t => {
  let tree; const calls = [], pending = deferred();
  const runtime = {user: {register: async (...args) => {calls.push(['register', ...args]); await pending.promise;}}, session: {getOwnerEpoch: () => 1, login: async (...args) => {calls.push(['login', ...args]);}}};
  const load = loader({...boundaries, 'expo-router': {Redirect: host('Redirect')},
    'src/features/customer/provider.tsx': {useCustomer: () => runtime, useCustomerSession: () => ({restoring: false, session: null})},
  });
  const {CustomerLogin} = load('src/features/customer/login.tsx');
  await act(async () => {tree = create(React.createElement(CustomerLogin));}); t.after(async () => act(() => tree.unmount()));
  await act(async () => tree.root.findAllByType('Pressable').filter(node => node.props.accessibilityRole === 'tab')[1].props.onPress());
  await act(async () => {findField(tree, 'Số điện thoại').props.onChangeText('0912345678'); findField(tree, 'Mật khẩu').props.onChangeText('password123'); findField(tree, 'Họ tên').props.onChangeText('  Khách thử nghiệm  ');});
  await act(async () => {const send = tree.root.findAllByType('Action').find(node => node.props.label === 'Tạo tài khoản và đăng nhập').props.onPress; send(); send();});
  assert.equal(calls.length, 1);
  await act(async () => {pending.resolve(); await flush();});
  assert.deepEqual(calls, [['register', '0912345678', 'password123', 'Khách thử nghiệm'], ['login', '0912345678', 'password123']]);
  assert.equal(findField(tree, 'Mật khẩu').props.value, '');
});

test('late registration cannot replace a session that changed while the public request was pending', async t => {
  let tree, epoch = 1, logins = 0; const pending = deferred();
  const runtime = {user: {register: () => pending.promise}, session: {getOwnerEpoch: () => epoch, login: async () => {logins++;}}};
  const load = loader({...boundaries, 'expo-router': {Redirect: host('Redirect')}, 'src/features/customer/provider.tsx': {useCustomer: () => runtime, useCustomerSession: () => ({restoring: false, session: null})}}), {CustomerLogin} = load('src/features/customer/login.tsx');
  await act(async () => {tree = create(React.createElement(CustomerLogin));}); t.after(async () => act(() => tree.unmount()));
  await act(async () => tree.root.findAllByType('Pressable').filter(node => node.props.accessibilityRole === 'tab')[1].props.onPress());
  await act(async () => {findField(tree, 'Số điện thoại').props.onChangeText('0912345678'); findField(tree, 'Mật khẩu').props.onChangeText('ValidPass123'); findField(tree, 'Họ tên').props.onChangeText('Khách kiểm thử');});
  await act(async () => tree.root.findAllByType('Action').find(node => node.props.label === 'Tạo tài khoản và đăng nhập').props.onPress()); epoch++;
  await act(async () => {pending.resolve(); await flush();}); assert.equal(logins, 0);
});

test('Customer session shell retains one booking owner across tab/detail mounts and resets on account switch', async t => {
  let tree, store, commands, activeReads = 0, streams = 0, stops = 0;
  const load = loader({...boundaries, 'expo-router': {Redirect: host('Redirect')},
    'src/features/ui/use-foreground.ts': {useForeground: () => true},
    'src/features/customer/provider.tsx': {useCustomer: () => runtime, useCustomerSession: () => React.useSyncExternalStore(session.subscribe, session.getSnapshot)},
  });
  const {UserSession} = load('src/features/backend/user-session.ts');
  let actor = ids.driver;
  const session = new UserSession({login: async () => ({accessToken: 't', refreshToken: 'r', expiresIn: 900}), profile: async () => ({id: actor}), logout: async () => {}}, {read: async () => null, write: async () => {}});
  await session.login('', '');
  const runtime = {base: 'https://test.invalid', session, trips: {active: async () => {activeReads++; return {data: null};}}, events: {subscribe: () => {streams++; return () => {stops++;};}}};
  const {CustomerSessionGate, useBooking} = load('src/features/customer/booking-provider.tsx');
  function Probe() {({store, command: commands} = useBooking()); return null;}
  const render = page => React.createElement(CustomerSessionGate, null, React.createElement(Probe, {key: page}));
  await act(async () => {tree = create(render('home')); await flush();}); t.after(async () => act(() => tree.unmount()));
  const original = store;
  await act(async () => {store.setPoint('pickup', {lat: 21, lng: 105}); store.setPoint('destination', {lat: 22, lng: 106}); store.setVehicle('CAR_7');});
  for (const page of ['history', 'account', 'detail', 'home']) await act(async () => tree.update(render(page)));
  assert.equal(store, original); assert.equal(store.getSnapshot().draft.vehicleType, 'CAR_7'); assert.equal(commands.ready, true); assert.equal(activeReads, 1); assert.equal(streams, 1);
  await act(async () => session.logout()); assert.equal(tree.root.findAllByType('Redirect').length, 1); assert.equal(stops, 1);
  actor = ids.other; await act(async () => {await session.login('', ''); await flush();});
  assert.notEqual(store, original); assert.deepEqual(store.getSnapshot().draft, {pickup: null, destination: null, vehicleType: 'CAR_4'});
});

test('Customer detail rejects late route response and supports Back with direct-link history fallback', async t => {
  let tree, tripId = ids.trip, canGoBack = false; const navigation = [], a = deferred(), b = deferred();
  const runtime = {session: {getOwnerEpoch: () => 1, authorized: work => work('t')}, trips: {detail: (_, id) => id === ids.trip ? a.promise : b.promise}};
  const load = loader({...boundaries,
    'expo-router': {useLocalSearchParams: () => ({id: tripId}), router: {canGoBack: () => canGoBack, back: () => navigation.push('back'), replace: path => navigation.push(path)}},
    'src/features/customer/provider.tsx': {useCustomer: () => runtime},
    'src/features/ui/trip-card.tsx': {TripCard: host('TripCard'), tripLabels: {}},
  });
  const {CustomerTripDetail} = load('src/features/customer/trip-detail.tsx');
  await act(async () => {tree = create(React.createElement(CustomerTripDetail));}); t.after(async () => act(() => tree.unmount()));
  await act(async () => {tripId = ids.offer; tree.update(React.createElement(CustomerTripDetail));});
  await act(async () => {a.reject(Error('OLD_PRIVATE_ERROR')); await flush();}); assert.doesNotMatch(JSON.stringify(tree.toJSON()), /OLD_PRIVATE_ERROR/); assert.equal(tree.root.findByType('Busy').props.visible, true);
  await act(async () => {b.reject(Error('private stack')); await flush();}); assert.doesNotMatch(JSON.stringify(tree.toJSON()), /private stack/);
  const back = () => tree.root.findAllByType('Action').find(node => node.props.label === 'Quay lại').props.onPress();
  await act(async () => back()); canGoBack = true; await act(async () => back()); assert.deepEqual(navigation, ['/customer/history', 'back']);
});

test('Customer neutral screen uses Customer branding; Driver wrapper keeps Driver branding and shell insets', async t => {
  const flatten = value => value;
  const load = loader({
    'react-native': {...native, ScrollView: host('ScrollView'), TextInput: host('TextInput'), ActivityIndicator: host('Busy'), Platform: {OS: 'android'}, StyleSheet: {create: flatten}},
    'expo-router': {Link: host('Link'), router: {}},
    'react-native-safe-area-context': {SafeAreaView: host('SafeAreaView')},
    '@/hooks/use-theme': {useTheme: () => ({})}, '@/constants/theme': {Spacing: {}, MaxContentWidth: 600},
    '@/components/themed-text': {ThemedText: host('Text')}, '@/components/themed-view': {ThemedView: host('View')},
    'src/features/ui/design.tsx': {Logo: host('Logo'), palette: {}},
  });
  const customer = load('src/features/ui/components.tsx').Screen, driver = load('src/features/driver/components/ui.tsx').Screen;
  let tree; await act(async () => {tree = create(React.createElement(customer, {title: 'Customer'}));}); t.after(async () => act(() => tree.unmount()));
  assert.equal(tree.root.findByType('Logo').props.driver, false);
  await act(async () => tree.update(React.createElement(driver, {title: 'Driver'}))); assert.equal(tree.root.findByType('Logo').props.driver, true);
  const {DriverShellContext} = load('src/features/driver/components/shell-context.ts');
  await act(async () => tree.update(React.createElement(DriverShellContext.Provider, {value: true}, React.createElement(driver, {title: 'Driver'}))));
  assert.deepEqual(tree.root.findByType('SafeAreaView').props.edges, []);
  await act(async () => tree.update(React.createElement(driver, {title: 'Driver', modal: true})));
  assert.deepEqual(tree.root.findByType('SafeAreaView').props.edges, ['bottom', 'left', 'right']);
});
