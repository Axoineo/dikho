package `in`.dikho.crm

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.webkit.MimeTypeMap
import androidx.core.content.pm.PackageInfoCompat
import androidx.webkit.WebViewCompat
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.PluginRegistry
import io.flutter.plugins.webviewflutter.WebViewFlutterAndroidExternalApi

/**
 * The single native entry point for the Dart side. Each method does one narrow
 * thing. None of this is reachable from web content: the page can only talk to
 * [WebViewBridge], and only from the CRM's origin.
 */
class CrmPlatformPlugin :
    FlutterPlugin,
    ActivityAware,
    MethodChannel.MethodCallHandler,
    EventChannel.StreamHandler,
    PluginRegistry.ActivityResultListener,
    PluginRegistry.NewIntentListener {

    private companion object {
        const val REQUEST_PICK_FILES = 7101
        const val REQUEST_CREATE_DOCUMENT = 7102
    }

    private val main = Handler(Looper.getMainLooper())
    private var binding: FlutterPlugin.FlutterPluginBinding? = null
    private var methods: MethodChannel? = null
    private var eventChannel: EventChannel? = null
    private var sink: EventChannel.EventSink? = null
    private val pendingEvents = ArrayDeque<Map<String, Any?>>()

    private var activityBinding: ActivityPluginBinding? = null
    private val activity: Activity? get() = activityBinding?.activity

    private var bridge: WebViewBridge? = null
    private var transfers: FileTransfers? = null
    private var installer: ApkInstaller? = null
    private var network: NetworkWatcher? = null

    private var pickResult: MethodChannel.Result? = null
    private var createDocumentCallback: ((Uri?) -> Unit)? = null
    private var initialLinkRead = false

    override fun onAttachedToEngine(flutterBinding: FlutterPlugin.FlutterPluginBinding) {
        binding = flutterBinding
        val context = flutterBinding.applicationContext
        val messenger = flutterBinding.binaryMessenger
        methods = MethodChannel(messenger, "in.dikho.crm/platform").also { it.setMethodCallHandler(this) }
        eventChannel = EventChannel(messenger, "in.dikho.crm/events").also { it.setStreamHandler(this) }

        val fileTransfers = FileTransfers(context, ::emit, ::createDocument, { activity })
        transfers = fileTransfers
        bridge = WebViewBridge(context, fileTransfers, ::emit)
        installer = ApkInstaller(context, ::emit) { activity }
        InstallResultReceiver.handler = installer
        network = NetworkWatcher(context) { emit(mapOf("type" to "network")) }.also { it.start() }
    }

    override fun onDetachedFromEngine(flutterBinding: FlutterPlugin.FlutterPluginBinding) {
        methods?.setMethodCallHandler(null)
        eventChannel?.setStreamHandler(null)
        network?.stop()
        InstallResultReceiver.handler = null
        binding = null
    }

    /* ── Activity ─────────────────────────────────────────────────────── */

    override fun onAttachedToActivity(newBinding: ActivityPluginBinding) {
        activityBinding = newBinding
        newBinding.addActivityResultListener(this)
        newBinding.addOnNewIntentListener(this)
    }

    override fun onDetachedFromActivity() {
        activityBinding?.removeActivityResultListener(this)
        activityBinding?.removeOnNewIntentListener(this)
        activityBinding = null
    }

    override fun onDetachedFromActivityForConfigChanges() = onDetachedFromActivity()

    override fun onReattachedToActivityForConfigChanges(newBinding: ActivityPluginBinding) =
        onAttachedToActivity(newBinding)

    fun onHostPause() {
        bridge?.onHostPause()
    }

    fun onHostResume() {
        bridge?.onHostResume()
    }

    override fun onNewIntent(intent: Intent): Boolean {
        val link = viewLink(intent) ?: return false
        emit(mapOf("type" to "deepLink", "url" to link))
        return true
    }

    private fun viewLink(intent: Intent?): String? =
        if (intent?.action == Intent.ACTION_VIEW) intent.dataString else null

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        when (requestCode) {
            REQUEST_PICK_FILES -> {
                val result = pickResult
                pickResult = null
                result?.success(if (resultCode == Activity.RESULT_OK) pickedUris(data) else emptyList<String>())
                return true
            }
            REQUEST_CREATE_DOCUMENT -> {
                val callback = createDocumentCallback
                createDocumentCallback = null
                callback?.invoke(if (resultCode == Activity.RESULT_OK) data?.data else null)
                return true
            }
        }
        return false
    }

    private fun pickedUris(data: Intent?): List<String> {
        val clip = data?.clipData
        if (clip != null) return (0 until clip.itemCount).map { clip.getItemAt(it).uri.toString() }
        return listOfNotNull(data?.data?.toString())
    }

    /* ── Methods ──────────────────────────────────────────────────────── */

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "getAppInfo" -> result.success(appInfo())
            "getInitialLink" -> {
                // Once per launch, so a rotation cannot replay the link.
                val link = if (initialLinkRead) null else viewLink(activity?.intent)
                initialLinkRead = true
                result.success(link)
            }
            "attachWebView" -> attachWebView(call, result)
            "openExternal" -> result.success(openExternal(call.argument<String>("url").orEmpty()))
            "pickFiles" -> pickFiles(call, result)
            "fetchFile" -> {
                transfers?.fetch(
                    url = call.argument<String>("url").orEmpty(),
                    view = call.argument<Boolean>("view") == true,
                    name = call.argument("name"),
                    mime = call.argument("mime"),
                    contentDisposition = call.argument("contentDisposition"),
                )
                result.success(null)
            }
            "openFile" -> result.success(
                transfers?.open(call.argument<String>("uri").orEmpty(), call.argument<String>("mime").orEmpty()) ?: false,
            )
            "shareFile" -> result.success(
                transfers?.share(call.argument<String>("uri").orEmpty(), call.argument<String>("mime").orEmpty()) ?: false,
            )
            "verifyApk" -> {
                val path = call.argument<String>("path").orEmpty()
                val code = call.argument<Number>("versionCode")?.toLong() ?: 0L
                installer?.verify(path, code) { rejected -> result.success(rejected) }
            }
            "canInstallPackages" -> result.success(installer?.canInstall() ?: false)
            "openInstallPermissionSettings" -> {
                installer?.openPermissionSettings()
                result.success(null)
            }
            "installApk" -> {
                installer?.install(call.argument<String>("path").orEmpty())
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    private fun appInfo(): Map<String, Any?> {
        val context = binding!!.applicationContext
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        val webView = WebViewCompat.getCurrentWebViewPackage(context)?.versionName
        return mapOf(
            "versionName" to info.versionName,
            "versionCode" to PackageInfoCompat.getLongVersionCode(info).toInt(),
            "sdkInt" to Build.VERSION.SDK_INT,
            "webViewMajor" to (webView?.substringBefore('.')?.toIntOrNull() ?: 0),
            "filesDir" to context.filesDir.path,
            "cacheDir" to context.cacheDir.path,
        )
    }

    private fun attachWebView(call: MethodCall, result: MethodChannel.Result) {
        val id = call.argument<Number>("id")?.toLong()
        val origin = call.argument<String>("origin")
        val flutterBinding = binding
        if (id == null || origin == null || flutterBinding == null) {
            result.success(false)
            return
        }
        transfers?.forceSaveDialog = call.argument<Boolean>("forceSaveDialog") == true
        val webView = WebViewFlutterAndroidExternalApi.getWebView(flutterBinding, id)
        result.success(webView != null && bridge?.attach(webView, origin) == true)
    }

    /**
     * Only schemes the Dart policy already allows, re-checked here, and always
     * as a plain view of the link: no component, package or extras from the page.
     */
    private fun openExternal(url: String): Boolean {
        val host = activity ?: return false
        val uri = Uri.parse(url)
        val intent = when (uri.scheme?.lowercase()) {
            "http", "https", "whatsapp", "geo" ->
                Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
            "tel" -> Intent(Intent.ACTION_DIAL, uri)
            "mailto", "sms" -> Intent(Intent.ACTION_SENDTO, uri)
            else -> return false
        }
        return try {
            host.startActivity(intent)
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }

    private fun pickFiles(call: MethodCall, result: MethodChannel.Result) {
        val host = activity
        if (host == null || pickResult != null) {
            result.success(emptyList<String>())
            return
        }
        val mimes = mimeTypesFor(call.argument<List<String>>("acceptTypes").orEmpty())
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, call.argument<Boolean>("multiple") == true)
        if (mimes.size == 1) {
            intent.type = mimes.first()
        } else {
            intent.type = "*/*"
            if (mimes.isNotEmpty()) intent.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toTypedArray())
        }
        pickResult = result
        try {
            host.startActivityForResult(intent, REQUEST_PICK_FILES)
        } catch (_: ActivityNotFoundException) {
            pickResult = null
            result.success(emptyList<String>())
        }
    }

    /** Turns an accept list like ".pdf,image/png" into MIME types the picker understands. */
    private fun mimeTypesFor(accept: List<String>): List<String> {
        val map = MimeTypeMap.getSingleton()
        val mimes = linkedSetOf<String>()
        for (raw in accept.flatMap { it.split(',') }) {
            val token = raw.trim().lowercase()
            when {
                token.isEmpty() -> Unit
                token.startsWith('.') -> {
                    // An extension Android has no type for: show everything
                    // rather than hide the file the person came for.
                    val mime = map.getMimeTypeFromExtension(token.drop(1)) ?: return emptyList()
                    mimes.add(mime)
                }
                token.contains('/') -> mimes.add(token)
                else -> return emptyList()
            }
        }
        return mimes.toList()
    }

    private fun createDocument(name: String, mime: String, callback: (Uri?) -> Unit) {
        val host = activity
        if (host == null || createDocumentCallback != null) {
            callback(null)
            return
        }
        createDocumentCallback = callback
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mime)
            .putExtra(Intent.EXTRA_TITLE, name)
        try {
            host.startActivityForResult(intent, REQUEST_CREATE_DOCUMENT)
        } catch (_: ActivityNotFoundException) {
            createDocumentCallback = null
            callback(null)
        }
    }

    /* ── Events ───────────────────────────────────────────────────────── */

    override fun onListen(arguments: Any?, events: EventChannel.EventSink) {
        sink = events
        while (pendingEvents.isNotEmpty()) events.success(pendingEvents.removeFirst())
    }

    override fun onCancel(arguments: Any?) {
        sink = null
    }

    private fun emit(event: Map<String, Any?>) {
        main.post {
            val current = sink
            if (current != null) {
                current.success(event)
            } else if (pendingEvents.size < 32) {
                pendingEvents.addLast(event)
            }
        }
    }
}
