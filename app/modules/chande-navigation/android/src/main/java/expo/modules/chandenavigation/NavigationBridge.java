package expo.modules.chandenavigation;

import android.os.Handler;
import android.os.Looper;

import androidx.annotation.Nullable;

import org.maplibre.navigation.core.models.DirectionsRoute;

import java.lang.ref.WeakReference;
import java.util.Map;

/**
 * Trạng thái dùng chung giữa module Expo (luồng của module) và {@link ChandeNavigationActivity} (luồng chính).
 * Tuyến được giữ ở đây thay vì Intent extra để không vướng giới hạn kích thước Binder và vẫn còn khi Activity
 * bị tạo lại do xoay màn hình.
 */
final class NavigationBridge {
  interface EventSink {
    void emit(String name, Map<String, Object> payload);
  }

  private static final Handler MAIN = new Handler(Looper.getMainLooper());
  private static volatile EventSink sink;
  private static DirectionsRoute route;
  private static boolean simulate;
  private static WeakReference<ChandeNavigationActivity> active = new WeakReference<>(null);

  private NavigationBridge() {}

  static void setEventSink(@Nullable EventSink value) {
    sink = value;
  }

  static void emit(String name, Map<String, Object> payload) {
    EventSink current = sink;
    if (current != null) {
      current.emit(name, payload);
    }
  }

  /** Kiểm tra JSON trước khi mở Activity để lỗi tuyến trả về Promise của JS. */
  static void prepare(String routeJson, boolean simulateRoute) {
    DirectionsRoute parsed = parse(routeJson);
    synchronized (NavigationBridge.class) {
      route = parsed;
      simulate = simulateRoute;
    }
  }

  @Nullable
  static synchronized DirectionsRoute route() {
    return route;
  }

  static synchronized boolean simulate() {
    return simulate;
  }

  /** Áp tuyến mới (sau khi lệch tuyến) vào phiên đang chạy. */
  static boolean updateRoute(String routeJson) {
    final DirectionsRoute parsed = parse(routeJson);
    final ChandeNavigationActivity activity = storeRouteAndGetActive(parsed);
    if (activity == null) {
      return false;
    }
    MAIN.post(() -> activity.applyRoute(parsed));
    return true;
  }

  @Nullable
  private static synchronized ChandeNavigationActivity storeRouteAndGetActive(DirectionsRoute parsed) {
    route = parsed;
    return active.get();
  }

  static void finishActive() {
    MAIN.post(() -> {
      ChandeNavigationActivity activity = current();
      if (activity != null) {
        activity.finishFromApp();
      }
    });
  }

  static boolean isActive() {
    return current() != null;
  }

  @Nullable
  private static synchronized ChandeNavigationActivity current() {
    return active.get();
  }

  static synchronized void attach(ChandeNavigationActivity activity) {
    active = new WeakReference<>(activity);
  }

  static synchronized void detach(ChandeNavigationActivity activity) {
    if (active.get() == activity) {
      active = new WeakReference<>(null);
    }
  }

  static synchronized void clear() {
    route = null;
    simulate = false;
  }

  private static DirectionsRoute parse(String routeJson) {
    if (routeJson == null || routeJson.isEmpty()) {
      throw new IllegalArgumentException("Thiếu tuyến đường để dẫn đường");
    }
    try {
      return DirectionsRoute.fromJson(routeJson);
    } catch (RuntimeException error) {
      throw new IllegalArgumentException("Tuyến đường không đúng định dạng của Navigation SDK: " + error.getMessage(), error);
    }
  }
}
