import type { HttpConfig, Service } from './config';
import { ApiError } from './errors';

const directRoutes = {
  otpRequest: '/driver-auth/otp/request', otpVerify: '/driver-auth/otp/verify',
  refresh: '/driver-auth/refresh', logout: '/driver-auth/logout',
  profile: '/drivers/me', vehicles: '/drivers/me/vehicles', vehicle: '/drivers/me/vehicles/:id',
  selection: '/drivers/me/selected-vehicle', availability: '/drivers/me/availability',
  activeTrip: '/trips/active', history: '/trips/history', detail: '/trips/:id',
  status: '/trips/:id/status', cancel: '/trips/:id/cancel',
} as const;
export type Operation = keyof typeof directRoutes;
export function route(config: HttpConfig, operation: Operation, id?: string) {
  // Future Gateway route changes belong here. Defaults require explicit contract confirmation.
  const gatewayRoutes: Partial<Record<Operation, string>> = {
    otpRequest: process.env.EXPO_PUBLIC_DRIVER_GATEWAY_OTP_REQUEST_PATH,
    otpVerify: process.env.EXPO_PUBLIC_DRIVER_GATEWAY_OTP_VERIFY_PATH,
    refresh: process.env.EXPO_PUBLIC_DRIVER_GATEWAY_REFRESH_PATH,
    logout: process.env.EXPO_PUBLIC_DRIVER_GATEWAY_LOGOUT_PATH,
    profile: process.env.EXPO_PUBLIC_DRIVER_GATEWAY_PROFILE_PATH,
    vehicles: process.env.EXPO_PUBLIC_DRIVER_GATEWAY_VEHICLES_PATH,
    vehicle: process.env.EXPO_PUBLIC_DRIVER_GATEWAY_VEHICLE_PATH,
    selection: process.env.EXPO_PUBLIC_DRIVER_GATEWAY_SELECTION_PATH,
    availability: process.env.EXPO_PUBLIC_DRIVER_GATEWAY_AVAILABILITY_PATH,
    activeTrip: process.env.EXPO_PUBLIC_DRIVER_GATEWAY_ACTIVE_TRIP_PATH,
    history: process.env.EXPO_PUBLIC_DRIVER_GATEWAY_HISTORY_PATH,
    detail: process.env.EXPO_PUBLIC_DRIVER_GATEWAY_TRIP_DETAIL_PATH,
    status: process.env.EXPO_PUBLIC_DRIVER_GATEWAY_TRIP_STATUS_PATH,
    cancel: process.env.EXPO_PUBLIC_DRIVER_GATEWAY_TRIP_CANCEL_PATH,
  };
  let path: string = config.mode === 'gateway'
    ? gatewayRoutes[operation] || `${config.gatewayPrefix}${directRoutes[operation]}`
    : directRoutes[operation];
  if (path.includes(':id')) {
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError('INVALID_ROUTE');
    path = path.replace(':id', encodeURIComponent(id));
  }
  if (!/^\/[A-Za-z0-9/_-]+$/.test(path) || path.includes('//')) throw new ApiError('INVALID_ROUTE');
  const service: Service = ['activeTrip', 'history', 'detail', 'status', 'cancel'].includes(operation) ? 'trip' : 'driver';
  return { service, path };
}
