export function realtimeBaseUrl(): string {
  // Expo only inlines statically named EXPO_PUBLIC_* references. No service credential belongs here.
  const value = process.env.EXPO_PUBLIC_DRIVER_REALTIME_BASE_URL?.trim().replace(/\/$/, '');
  if (!value) throw new Error('REALTIME_NOT_CONFIGURED');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('REALTIME_NOT_CONFIGURED');
  return value;
}
