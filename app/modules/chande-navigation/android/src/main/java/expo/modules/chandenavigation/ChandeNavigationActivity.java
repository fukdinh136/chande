package expo.modules.chandenavigation;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.WindowManager;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import org.maplibre.android.MapLibre;
import org.maplibre.geojson.Point;
import org.maplibre.navigation.android.navigation.ui.v5.NavigationView;
import org.maplibre.navigation.android.navigation.ui.v5.NavigationViewOptions;
import org.maplibre.navigation.android.navigation.ui.v5.OnNavigationReadyCallback;
import org.maplibre.navigation.android.navigation.ui.v5.listeners.NavigationListener;
import org.maplibre.navigation.android.navigation.ui.v5.listeners.RouteListener;
import org.maplibre.navigation.core.location.Location;
import org.maplibre.navigation.core.models.DirectionsRoute;
import org.maplibre.navigation.core.navigation.MapLibreNavigation;
import org.maplibre.navigation.core.navigation.MapLibreNavigationOptions;
import org.maplibre.navigation.core.routeprogress.ProgressChangeListener;
import org.maplibre.navigation.core.routeprogress.RouteProgress;

import java.util.HashMap;
import java.util.Map;

/**
 * Màn hình dẫn đường từng chặng dùng {@code NavigationView} của MapLibre Navigation SDK.
 * Vòng đời được chuyển tiếp như {@code MapLibreNavigationActivity} của SDK; khác ở chỗ sự kiện được gửi về JS
 * và việc tính lại tuyến khi lệch đường do app đảm nhiệm (gọi routing-service rồi {@code updateRoute}).
 */
public class ChandeNavigationActivity extends AppCompatActivity
    implements OnNavigationReadyCallback, NavigationListener, RouteListener, ProgressChangeListener {

  private static final long FINISH_AFTER_ARRIVAL_MS = 3000;
  private static final long OFF_ROUTE_EVENT_INTERVAL_MS = 5000;
  /** SDK coi quãng đường còn lại bằng 0 là lệch tuyến; gần đích thì bỏ qua để không tính lại tuyến vô ích. */
  private static final double IGNORE_OFF_ROUTE_NEAR_END_M = 60;

  private final Handler handler = new Handler(Looper.getMainLooper());
  private NavigationView navigationView;
  private boolean ended;
  private boolean arrived;
  private long lastOffRouteAt;
  private double lastDistanceRemaining = Double.MAX_VALUE;

  @Override
  protected void onCreate(@Nullable Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (NavigationBridge.route() == null) {
      // Tiến trình được khôi phục sau khi bị hệ thống thu hồi: không còn tuyến trong bộ nhớ.
      ended = true;
      finish();
      return;
    }
    MapLibre.getInstance(getApplicationContext());
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    setContentView(R.layout.chande_navigation_activity);
    navigationView = findViewById(R.id.chandeNavigationView);
    // targetSdk 35+ luôn vẽ tràn viền; đệm theo thanh hệ thống để banner chỉ dẫn không nằm dưới status bar.
    ViewCompat.setOnApplyWindowInsetsListener(navigationView, (view, insets) -> {
      Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
      return WindowInsetsCompat.CONSUMED;
    });
    navigationView.onCreate(savedInstanceState);
    navigationView.initialize(this);
    getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
      @Override
      public void handleOnBackPressed() {
        if (!navigationView.onBackPressed()) {
          end("cancelled", null);
        }
      }
    });
    NavigationBridge.attach(this);
  }

  @Override
  public void onNavigationReady(boolean isRunning) {
    DirectionsRoute route = NavigationBridge.route();
    if (route == null) {
      end("error", "Không còn tuyến để dẫn đường");
      return;
    }
    MapLibreNavigationOptions navigationOptions = new MapLibreNavigationOptions().toBuilder()
        .withTimeFormatType(MapLibreNavigationOptions.TimeFormat.TWENTY_FOUR_HOURS)
        .build();
    NavigationViewOptions options = NavigationViewOptions.builder()
        .directionsRoute(route)
        .shouldSimulateRoute(NavigationBridge.simulate())
        .navigationOptions(navigationOptions)
        .navigationListener(this)
        .routeListener(this)
        .progressChangeListener(this)
        .build();
    try {
      navigationView.startNavigation(options);
    } catch (RuntimeException error) {
      end("error", error.getMessage());
    }
  }

  /** Gọi trên luồng chính khi JS gửi tuyến mới sau sự kiện lệch tuyến. */
  void applyRoute(DirectionsRoute route) {
    if (ended || navigationView == null) {
      return;
    }
    MapLibreNavigation navigation = navigationView.retrieveMapLibreNavigation();
    if (navigation == null) {
      return;
    }
    // Đổi tuyến trực tiếp trên engine: gọi lại NavigationView.startNavigation sẽ đăng ký trùng listener của bản đồ.
    // Đường vẽ trên bản đồ tự cập nhật ở lần tiến trình kế tiếp (MapRouteProgressChangeListener).
    navigation.startNavigation(route);
    lastDistanceRemaining = Double.MAX_VALUE;
  }

  void finishFromApp() {
    end("cancelled", null);
  }

  // NavigationListener

  @Override
  public void onCancelNavigation() {
    end("cancelled", null);
  }

  @Override
  public void onNavigationFinished() {
    // Engine dừng (ví dụ khi Activity bị huỷ); kết quả cho JS đã gửi ở end().
  }

  @Override
  public void onNavigationRunning() {
    NavigationBridge.emit("onRunning", new HashMap<>());
  }

  // RouteListener

  @Override
  public boolean allowRerouteFrom(Point offRoutePoint) {
    long now = SystemClock.elapsedRealtime();
    if (!arrived && lastDistanceRemaining > IGNORE_OFF_ROUTE_NEAR_END_M && now - lastOffRouteAt >= OFF_ROUTE_EVENT_INTERVAL_MS) {
      lastOffRouteAt = now;
      Map<String, Object> payload = new HashMap<>();
      payload.put("latitude", offRoutePoint.latitude());
      payload.put("longitude", offRoutePoint.longitude());
      NavigationBridge.emit("onOffRoute", payload);
    }
    // Không để SDK tự gọi Directions API: tuyến mới do routing-service của hệ thống tính.
    return false;
  }

  @Override
  public void onOffRoute(Point offRoutePoint) {
    // Không xảy ra vì allowRerouteFrom luôn trả false.
  }

  @Override
  public void onRerouteAlong(DirectionsRoute directionsRoute) {
    // Tuyến mới được áp qua applyRoute.
  }

  @Override
  public void onFailedReroute(String errorMessage) {
    // SDK không tự tính lại tuyến trong cấu hình này.
  }

  @Override
  public void onArrival() {
    // SDK gọi lại mỗi lần cập nhật khi đang ở vùng đích; chỉ xử lý lần đầu.
    if (arrived || ended) {
      return;
    }
    arrived = true;
    NavigationBridge.emit("onArrival", new HashMap<>());
    handler.postDelayed(() -> end("arrived", null), FINISH_AFTER_ARRIVAL_MS);
  }

  // ProgressChangeListener

  @Override
  public void onProgressChange(@NonNull Location location, @NonNull RouteProgress routeProgress) {
    lastDistanceRemaining = routeProgress.getDistanceRemaining();
    Map<String, Object> payload = new HashMap<>();
    payload.put("distanceRemaining", routeProgress.getDistanceRemaining());
    payload.put("durationRemaining", routeProgress.getDurationRemaining());
    payload.put("fractionTraveled", (double) routeProgress.getFractionTraveled());
    payload.put("legIndex", routeProgress.getLegIndex());
    payload.put("stepIndex", routeProgress.getStepIndex());
    payload.put("stepDistanceRemaining", routeProgress.getStepDistanceRemaining());
    payload.put("latitude", location.getLatitude());
    payload.put("longitude", location.getLongitude());
    NavigationBridge.emit("onProgress", payload);
  }

  private void end(String reason, @Nullable String message) {
    if (ended) {
      return;
    }
    ended = true;
    handler.removeCallbacksAndMessages(null);
    Map<String, Object> payload = new HashMap<>();
    payload.put("reason", reason);
    payload.put("message", message);
    NavigationBridge.emit("onEnded", payload);
    NavigationBridge.detach(this);
    NavigationBridge.clear();
    finish();
  }

  // Chuyển tiếp vòng đời cho NavigationView (bắt buộc với MapView của MapLibre).

  @Override
  public void onStart() {
    super.onStart();
    if (navigationView != null) navigationView.onStart();
  }

  @Override
  public void onResume() {
    super.onResume();
    if (navigationView != null) navigationView.onResume();
  }

  @Override
  public void onPause() {
    super.onPause();
    if (navigationView != null) navigationView.onPause();
  }

  @Override
  public void onStop() {
    super.onStop();
    if (navigationView != null) navigationView.onStop();
  }

  @Override
  public void onLowMemory() {
    super.onLowMemory();
    if (navigationView != null) navigationView.onLowMemory();
  }

  @Override
  protected void onSaveInstanceState(@NonNull Bundle outState) {
    if (navigationView != null) navigationView.onSaveInstanceState(outState);
    super.onSaveInstanceState(outState);
  }

  @Override
  protected void onRestoreInstanceState(@NonNull Bundle savedInstanceState) {
    super.onRestoreInstanceState(savedInstanceState);
    if (navigationView != null) navigationView.onRestoreInstanceState(savedInstanceState);
  }

  @Override
  protected void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    if (navigationView != null) navigationView.onDestroy();
    if (!isChangingConfigurations()) {
      // Bị đóng ngoài luồng thông thường (ví dụ hệ thống huỷ Activity): vẫn báo kết thúc cho JS.
      end("cancelled", null);
    }
    NavigationBridge.detach(this);
    super.onDestroy();
  }
}
