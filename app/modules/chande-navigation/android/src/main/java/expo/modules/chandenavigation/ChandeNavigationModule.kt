package expo.modules.chandenavigation

import android.content.Intent
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class StartNavigationOptions : Record {
  @Field
  val routeJson: String = ""

  @Field
  val simulate: Boolean = false
}

class ChandeNavigationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ChandeNavigation")

    Events("onRunning", "onProgress", "onOffRoute", "onArrival", "onEnded")

    OnCreate {
      NavigationBridge.setEventSink { name, payload -> sendEvent(name, payload) }
    }

    OnDestroy {
      NavigationBridge.setEventSink(null)
    }

    AsyncFunction("start") { options: StartNavigationOptions ->
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      NavigationBridge.prepare(options.routeJson, options.simulate)
      activity.startActivity(Intent(activity, ChandeNavigationActivity::class.java))
    }

    AsyncFunction("updateRoute") { routeJson: String ->
      NavigationBridge.updateRoute(routeJson)
    }

    AsyncFunction("stop") {
      NavigationBridge.finishActive()
    }

    Function("isActive") {
      NavigationBridge.isActive()
    }
  }
}
