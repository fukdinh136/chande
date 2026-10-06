package expo.modules.veloxnavigation

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.Flow
import org.maplibre.navigation.core.location.Location
import org.maplibre.navigation.core.location.engine.LocationEngine
import org.maplibre.navigation.core.models.DirectionsRoute
import org.maplibre.navigation.core.navigation.MapLibreNavigation
import org.maplibre.navigation.core.navigation.MapLibreNavigationOptions

// One Expo GPS stream feeds the SDK and server publisher; no independent native GPS fetcher.
class InjectedLocationEngine : LocationEngine {
  val updates = MutableSharedFlow<Location>(replay = 1, extraBufferCapacity = 16)
  var last: Location? = null
  override fun listenToLocation(request: LocationEngine.Request): Flow<Location> = updates
  override suspend fun getLastLocation(): Location? = last
  fun push(value: Location) { last = value; updates.tryEmit(value) }
}
class VeloxNavigationModule : Module() {
  private var navigation: MapLibreNavigation? = null
  private val engine = InjectedLocationEngine()
  private var session = ""
  private fun stop() { session = ""; navigation?.onDestroy(); navigation = null }
  override fun definition() = ModuleDefinition {
    Name("VeloxNavigation")
    Events("progress", "offRoute")
    Function("start") { routeJson: String, sessionId: String ->
      val route = DirectionsRoute.fromJson(routeJson)
      stop(); session = sessionId
      val sdk = MapLibreNavigation(locationEngine = engine, options = MapLibreNavigationOptions(defaultMilestonesEnabled = false, enableFasterRouteDetection = false, manuallyEndNavigationUponCompletion = true))
      sdk.addProgressChangeListener { location, progress ->
        if (session == sessionId) {
          val next = progress.currentLegProgress.upComingStep ?: progress.currentLegProgress.currentStep
          sendEvent("progress", mapOf("sessionId" to sessionId, "remainingDistanceMeters" to progress.distanceRemaining, "remainingDurationSeconds" to progress.durationRemaining, "distanceToManeuverMeters" to progress.stepDistanceRemaining, "street" to next.name, "maneuver" to next.maneuver.type?.text, "modifier" to next.maneuver.modifier?.text, "lat" to location.latitude, "lng" to location.longitude))
        }
      }
      sdk.addOffRouteListener { if (session == sessionId) sendEvent("offRoute", mapOf("sessionId" to sessionId)) }
      navigation = sdk; sdk.startNavigation(route)
      true
    }
    Function("pushLocation") { lat: Double, lng: Double, accuracy: Double, timestamp: Double, speed: Double, bearing: Double ->
      if (lat.isFinite() && lng.isFinite() && accuracy.isFinite() && accuracy >= 0 && kotlin.math.abs(lat) <= 90 && kotlin.math.abs(lng) <= 180) engine.push(Location(latitude = lat, longitude = lng, accuracyMeters = accuracy.toFloat(), timeMilliseconds = timestamp.toLong(), speedMetersPerSeconds = if (speed >= 0) speed.toFloat() else null, bearing = if (bearing >= 0) bearing.toFloat() else null))
    }
    Function("stop") { stop() }
    OnDestroy { stop() }
  }
}
