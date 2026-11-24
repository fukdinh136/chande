const { test } = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), { act, create } = require('react-test-renderer');
const { loader, flush, owner, ids } = require('./helpers/driver.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const host = name => {
  function DriverTestHost(props) { return React.createElement(name, props, props.children); }
  DriverTestHost.displayName = name;
  return DriverTestHost;
};
const ui = Object.fromEntries(['Action', 'Busy', 'Card', 'ErrorNotice', 'Field', 'Notice', 'RouteAction', 'Screen'].map(name => [name, host(name)]));
const profile = { driverId: ids.driver, phoneNumber: '84900000001', fullName: 'Original', licenseNumber: 'TEST-LICENSE', avatarUrl: null, desiredStatus: 'OFFLINE', createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z' };
test('Driver Profile keeps dirty input on background refresh and success notice after save', async t => {
  const session = owner(); let current = profile, tree, resource;
  const runtime = { session, trip: { enabled: true }, driver: { updateProfile: async body => ({ ...current, ...body, updatedAt: '2026-10-12T01:00:00Z' }) } };
  const load = loader({
    'src/features/driver/components/ui.tsx': ui,
    'src/features/driver/state/driver-provider.tsx': { useDriverRuntime: () => runtime },
    'src/features/driver/state/session-resources.tsx': { useDriverResources: () => ({ store: { profile: resource }, intent: { data: { desiredStatus: 'OFFLINE' } }, active: { data: null } }) },
    'src/features/driver/hooks/use-focused-resource.ts': { useFocusedResource: value => ({ ...React.useSyncExternalStore(value.subscribe, value.getSnapshot), refresh: value.refresh, replace: value.replace }) },
  });
  const { DriverResource } = load('src/features/driver/state/driver-resource.ts'); resource = new DriverResource(async () => current, () => true); resource.replace(current);
  const { ProfileScreen } = load('src/features/driver/screens/profile-screen.tsx');
  await act(async () => { tree = create(React.createElement(ProfileScreen)); }); t.after(async () => { await act(async () => tree.unmount()); resource.clear(); });
  const field = () => tree.root.findAllByType('Field').find(n => n.props.label === 'Họ tên');
  await act(async () => field().props.onChangeText('Edited locally'));
  await act(async () => { current = { ...profile, fullName: 'Server changed', avatarUrl: 'https://example.test/new.png' }; resource.replace(current); });
  assert.equal(field().props.value, 'Edited locally'); assert.equal(tree.root.findAllByType('Field').find(n => n.props.label === 'URL ảnh hồ sơ').props.value, current.avatarUrl);
  await act(async () => tree.root.findAllByType('Action').find(n => n.props.label === 'Lưu hồ sơ').props.onPress());
  assert.ok(tree.root.findAllByType('Notice').some(n => n.props.children === 'Đã lưu hồ sơ trên máy chủ.')); assert.equal(field().props.value, 'Edited locally');
});
test('Driver mutation locks duplicate submission and ignores notice/error after owner change', async () => {
  const session = owner(), load = loader(), { useMutation } = load('src/features/driver/hooks/use-mutation.ts'); let mutation, tree, resolve, calls = 0;
  function Probe() { mutation = useMutation(session); return null; }
  await act(async () => { tree = create(React.createElement(Probe)); });
  await act(async () => {
    const job = () => { calls++; return new Promise(r => { resolve = r; }); };
    void mutation.run(job, 'saved'); void mutation.run(job, 'saved');
  }); assert.equal(calls, 1); assert.equal(mutation.busy, true);
  await act(async () => { session.change(ids.other); resolve(); await flush(); }); assert.equal(mutation.notice, null); assert.equal(mutation.error, null);
  await act(async () => tree.unmount());
});
test('Driver Home and route changes retain one shell resource/offer/GPS scope; login mounts none', async t => {
  const session = owner(); let path = '/driver', tree; const count = { offers: 0, stopped: 0, gps: 0, gpsStop: 0, connections: 0, disconnects: 0, intent: 0, active: 0 };
  const offerState = { driverId: ids.driver, phase: 'idle', remaining: 0 }, gpsState = { requested: false, foreground: true, watcher: 'paused', permission: 'unknown', connection: 'paused', issue: null, error: null };
  const noopSubscription = () => () => {};
  const runtime = { session, config: { pollIntervalMs: 15000 }, trip: { enabled: true, clear: () => {}, active: async () => { count.active++; return null; } },
    commands: { initialize: async () => {}, subscribe: noopSubscription, getSnapshot: () => ({ busy: false }) },
    driver: { availability: async () => { count.intent++; return { desiredStatus: 'OFFLINE', selectedVehicleId: null }; } },
    realtime: { connect: async () => { count.connections++; }, disconnect: () => { count.disconnects++; }, subscribe: noopSubscription },
    offers: { start: () => { count.offers++; }, stop: () => { count.stopped++; }, setForeground: () => {}, observeActive: () => {}, subscribe: noopSubscription, getSnapshot: () => offerState, refresh: () => {}, refreshAll: () => {}, decide: () => {}, retry: () => {} },
    gps: { limits: { freshnessMs: 30000 }, subscribe: noopSubscription, getSnapshot: () => gpsState, configure: () => { count.gps++; }, stop: () => { count.gpsStop++; } }, capabilities: { realtime: { configured: false } } };
  // Native views/router are boundaries; real shell, resource provider, OffersProvider,
  // GpsCard and useDriverGps run through React mount/update/unmount.
  session.getResourceEpoch = () => 1;
  const load = loader({
    'react-native': { View: host('View'), Switch: host('Switch'), Pressable: host('Pressable'), Modal: props => props.visible ? React.createElement('Modal', props, props.children) : null },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    'expo-router': { Slot: () => React.createElement('Route', { path }), Redirect: host('Redirect'), usePathname: () => path, router: {}, useFocusEffect: () => {} },
    '@/hooks/use-theme': { useTheme: () => ({}) }, '@/components/themed-text': { ThemedText: host('Text') },
    'src/features/driver/components/ui.tsx': ui, 'src/features/ui/design.tsx': { palette: {} },
    'src/features/driver/components/driver-tabs.tsx': { DriverTabs: host('Tabs') },
    'src/features/driver/components/session-notice.tsx': { SessionNotice: host('SessionNotice'), SessionRecoveryScreen: host('Recovery') },
    'src/features/driver/screens/offers-screen.tsx': { OffersScreen: host('OffersScreen') },
    'src/features/driver/hooks/use-driver-foreground.ts': { useDriverForeground: () => true },
    'src/features/driver/state/driver-provider.tsx': { useDriverRuntime: () => runtime, useDriverSession: () => React.useSyncExternalStore(session.subscribe, session.getSnapshot) },
  });
  const { SessionGate } = load('src/features/driver/components/session-gate.tsx');
  await act(async () => { tree = create(React.createElement(SessionGate)); await flush(); });
  t.after(async () => { await act(async () => tree.unmount()); });
  const original = { ...count };
  for (path of ['/driver/offers', '/driver/trip', '/driver/vehicles', '/driver/history', '/driver/profile', '/driver']) await act(async () => tree.update(React.createElement(SessionGate)));
  assert.equal(count.offers, 1); assert.equal(count.connections, 1); assert.equal(count.gps, original.gps); assert.equal(count.intent, 1); assert.equal(count.active, 1);
  const areas = tree.root.findAllByType('SafeAreaView'); assert.deepEqual(areas.map(n => n.props.edges), [['top', 'left', 'right'], ['bottom']]);
  await act(async () => session.change(null)); assert.equal(tree.root.findAllByType('Recovery').length, 1); assert.equal(count.stopped, 1); assert.equal(count.disconnects, 1);
  await act(async () => session.update({ phase: 'signed-out', session: null })); assert.equal(tree.root.findAllByType('Redirect').length, 1); assert.equal(count.offers, 1);
  await act(async () => tree.unmount());
});
test('Driver map fits pickup/destination without route, preserves manual camera on GPS updates and supports recenter', async t => {
  const moves = [], camera = { fitBounds: (...args) => moves.push(['fit', ...args]), easeTo: value => moves.push(['ease', value]), flyTo: value => moves.push(['fly', value]) };
  const Camera = React.forwardRef((_, ref) => { React.useImperativeHandle(ref, () => camera); return null; });
  Camera.displayName = 'DriverTestCamera';
  const load = loader({
    'react-native': { View: host('View'), Text: host('Text'), Pressable: host('Pressable'), StyleSheet: { create: value => value } },
    '@maplibre/maplibre-react-native': { Map: host('Map'), Camera, Marker: host('Marker'), GeoJSONSource: host('Source'), Layer: host('Layer') },
    '@expo/vector-icons': { Ionicons: host('Icon') }, 'src/features/ui/design.tsx': { palette: {} },
  });
  const { RideMap } = load('src/features/map/ride-map.tsx'); let tree;
  const props = { fitKey: 'trip/pickup', pickup: { lat: 21, lng: 105 }, destination: { lat: 22, lng: 106 }, position: { lat: 21, lng: 105 } };
  await act(async () => { tree = create(React.createElement(RideMap, props)); }); t.after(async () => { await act(async () => tree.unmount()); });
  await act(async () => tree.root.findByType('Map').props.onDidFinishLoadingMap()); assert.equal(moves.length, 1); assert.deepEqual(moves[0][1], [105, 21, 106, 22]);
  await act(async () => tree.update(React.createElement(RideMap, { ...props, position: { lat: 21.05, lng: 105.05 } }))); assert.equal(moves.length, 1);
  await act(async () => tree.root.findByType('Pressable').props.onPress()); assert.equal(moves.length, 2);
  await act(async () => tree.update(React.createElement(RideMap, { fitKey: 'trip/dropoff', pickup: props.destination }))); assert.equal(moves.at(-1)[0], 'ease'); assert.equal(moves.at(-1)[1].zoom, 15);
});

test('Driver RouteAction renders through the real Expo Router Slot and preserves style, accessibility and destination', async () => {
  const visited = [], flatten = value => Array.isArray(value) ? Object.assign({}, ...value.map(flatten)) : value;
  let NativeSlot;
  function Link({ href, asChild, children }) {
    assert.equal(asChild, true);
    return React.createElement(NativeSlot, { onPress: () => visited.push(href) }, children);
  }
  // Exercise the installed Router's actual style guard and Radix prop merging;
  // only native views and the outer router context are test boundaries.
  const load = loader({
    'react-native': {
      Platform: { OS: 'android' }, Pressable: host('Pressable'), View: host('View'), ScrollView: host('ScrollView'),
      TextInput: host('TextInput'), ActivityIndicator: host('ActivityIndicator'), StyleSheet: { create: value => value, flatten },
    },
    'expo-router': { Link, router: {} },
    '@radix-ui/react-slot': require(require.resolve('@radix-ui/react-slot', { paths: [require.resolve('expo-router/package.json')] })),
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/hooks/use-theme': { useTheme: () => ({ backgroundElement: '#112233' }) },
    '@/constants/theme': { Spacing: { two: 8, three: 16 }, MaxContentWidth: 600 },
    '@/components/themed-text': { ThemedText: host('Text') },
    '@/components/themed-view': { ThemedView: host('View') },
    'src/features/ui/design.tsx': { Logo: host('Logo'), palette: { line: '#778899' } },
  });
  NativeSlot = load('node_modules/expo-router/build/ui/Slot.js').Slot;
  const { RouteAction } = load('src/features/driver/components/ui.tsx');
  for (const href of ['/driver/trip', '/driver/offers', '/driver/vehicles', '/driver/profile', '/driver/history']) {
    let tree;
    try {
      await act(async () => { tree = create(React.createElement(RouteAction, { href, label: 'Mở màn hình' })); });
      const button = tree.root.findByType('Pressable');
      assert.equal(Array.isArray(button.props.style), false);
      assert.equal(button.props.style.minHeight, 56);
      assert.equal(button.props.style.borderColor, '#778899');
      assert.equal(button.props.style.backgroundColor, '#112233');
      assert.equal(button.props.accessibilityRole, 'button');
      assert.equal(button.props.accessibilityLabel, 'Mở màn hình');
      await act(async () => button.props.onPress());
      assert.equal(visited.at(-1), href);
    } finally {
      if (tree) await act(async () => tree.unmount());
    }
  }
});
