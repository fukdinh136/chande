import * as Location from 'expo-location';
import type {Point} from '../backend/clients';
import {bookingPoint} from './booking-policy';

import {CustomerLocationError} from './location-errors';
export {CustomerLocationError, locationMessage} from './location-errors';

// Called only by the explicit button. No watcher, cached location or background GPS.
export function currentLocation(signal: AbortSignal, timeoutMs = 20000): Promise<Point> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error: unknown, value?: Point) => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value!);
    };
    const abort = () => finish(new CustomerLocationError('CANCELLED'));
    const timer = setTimeout(() => finish(new CustomerLocationError('TIMEOUT')), timeoutMs);
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) {abort(); return;}
    void (async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (finished) return;
      if (!permission.granted) throw new CustomerLocationError('DENIED');
      const enabled = await Location.hasServicesEnabledAsync();
      if (finished) return;
      if (!enabled) throw new CustomerLocationError('DISABLED');
      const sample = await Location.getCurrentPositionAsync({accuracy: Location.Accuracy.Balanced});
      if (finished) return;
      if (!Number.isFinite(sample.timestamp) || Date.now() - sample.timestamp > 60000 || sample.timestamp > Date.now() + 10000) throw new CustomerLocationError('UNAVAILABLE');
      finish(null, bookingPoint({lat: sample.coords.latitude, lng: sample.coords.longitude}));
    })().catch(error => finish(error));
  });
}
