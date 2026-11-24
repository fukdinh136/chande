import {LogManager} from '@maplibre/maplibre-react-native';

const listeners = new Set<() => void>();
let installed = false;

// Native tile failures don't raise Map.onDidFailLoadingMap (style failures do).
// One dispatcher avoids replacing another mounted Customer map's listener.
export function observeTileFailures(listener: () => void) {
  if (!installed) {
    installed = true;
    LogManager.onLog(event => {
      if (event.level !== 'error' || !event.message.includes('Failed to load tile ') || !listeners.size) return false;
      listeners.forEach(notify => notify());
      // This known loading error is now represented by the map's retry notice.
      // Unrelated errors and maps without a listener keep native default logging.
      return true;
    });
  }
  listeners.add(listener);
  return () => {listeners.delete(listener);};
}
