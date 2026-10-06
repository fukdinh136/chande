import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors } from './tokens';

// Thiết kế dùng Material Symbols; Android/web vẽ đúng bộ đó, iOS dùng SF Symbol tương ứng.
const ICONS = {
  add: 'plus',
  airport_shuttle: 'bus.fill',
  arrow_back: 'chevron.left',
  bolt: 'bolt.fill',
  call: 'phone.fill',
  cancel: 'xmark.circle',
  check: 'checkmark',
  chevron_right: 'chevron.right',
  close: 'xmark',
  delete: 'trash',
  devices: 'laptopcomputer.and.iphone',
  directions: 'arrow.triangle.turn.up.right.diamond.fill',
  directions_car: 'car.fill',
  edit: 'pencil',
  edit_location: 'mappin.and.ellipse',
  error: 'exclamationmark.circle',
  flag: 'flag.fill',
  history: 'clock.arrow.circlepath',
  home: 'house.fill',
  info: 'info.circle',
  local_taxi: 'car.side.fill',
  location_on: 'mappin',
  lock: 'lock.fill',
  logout: 'rectangle.portrait.and.arrow.right',
  map: 'map',
  my_location: 'location.fill',
  navigation: 'location.north.line.fill',
  near_me: 'location.north.fill',
  payments: 'banknote',
  person: 'person.fill',
  pin_drop: 'mappin.circle',
  receipt_long: 'doc.text',
  refresh: 'arrow.clockwise',
  route: 'point.topleft.down.curvedto.point.bottomright.up',
  schedule: 'clock',
  search: 'magnifyingglass',
  star: 'star.fill',
  sync: 'arrow.triangle.2.circlepath',
  two_wheeler: 'scooter',
  verified: 'checkmark.seal.fill',
  warning: 'exclamationmark.triangle.fill',
  wifi_off: 'wifi.slash',
  work: 'briefcase.fill',
} as const satisfies Partial<Record<AndroidSymbol, SFSymbol>>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, color = colors.onSurface, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<ViewStyle> }) {
  return <SymbolView name={{ ios: ICONS[name], android: name, web: name }} size={size} tintColor={color} style={style} />;
}
