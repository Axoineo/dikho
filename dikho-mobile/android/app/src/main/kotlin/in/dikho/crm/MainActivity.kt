package `in`.dikho.crm

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    private val platform = CrmPlatformPlugin()

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        flutterEngine.plugins.add(platform)
    }

    // Marks the page hidden while the app is in the background, so the CRM's
    // heartbeat and animations stop rather than draining the battery.
    override fun onPause() {
        platform.onHostPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        platform.onHostResume()
    }
}
