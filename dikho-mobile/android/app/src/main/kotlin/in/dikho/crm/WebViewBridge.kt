package `in`.dikho.crm

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.webkit.CookieManager
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONException
import org.json.JSONObject

/**
 * The only path from web content to native code. Android delivers messages and
 * injects the script for the pinned origin alone, in contrast to
 * addJavascriptInterface, which any frame or redirect target could call. Every
 * message is still treated as untrusted and checked field by field, and the
 * only things it can do are save a file, copy text, and report the page's edge
 * colours.
 */
internal class WebViewBridge(
    private val context: Context,
    private val transfers: FileTransfers,
    private val emit: (Map<String, Any?>) -> Unit,
) {
    private companion object {
        const val OBJECT_NAME = "DikhoAndroid"
        const val MAX_MESSAGE_CHARS = 800 * 1024
        const val MAX_COPY_CHARS = 65536
    }

    private var webView: WebView? = null
    private var origin: String = ""

    /** Returns false when this WebView is too old to pin by origin. */
    fun attach(view: WebView, allowedOrigin: String): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
            !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        ) {
            return false
        }
        origin = allowedOrigin
        webView = view

        view.settings.apply {
            @Suppress("DEPRECATION")
            saveFormData = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) safeBrowsingEnabled = true
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)

        // Replaces the plugin's listener, which would otherwise re-enter this
        // URL as a navigation and loop.
        view.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            val attachment = contentDisposition?.contains("attachment", ignoreCase = true) == true
            emit(
                mapOf(
                    "type" to "fileRequested",
                    "url" to url,
                    "view" to !attachment,
                    "mime" to mimeType,
                    "contentDisposition" to contentDisposition,
                ),
            )
        }

        WebViewCompat.addWebMessageListener(view, OBJECT_NAME, setOf(allowedOrigin), ::onMessage)
        val script = context.resources.openRawResource(R.raw.page_bridge).bufferedReader().use { it.readText() }
        WebViewCompat.addDocumentStartJavaScript(view, script, setOf(allowedOrigin))
        transfers.removeStaleFiles()
        return true
    }

    fun onHostPause() {
        webView?.onPause()
    }

    fun onHostResume() {
        webView?.onResume()
    }

    private fun onMessage(
        @Suppress("UNUSED_PARAMETER") view: WebView,
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        reply: JavaScriptReplyProxy,
    ) {
        if (!isMainFrame || sourceOrigin.toString().trimEnd('/') != origin) return
        val text = message.data ?: return
        if (text.length > MAX_MESSAGE_CHARS) return
        val json = try {
            JSONObject(text)
        } catch (_: JSONException) {
            return
        }

        when (json.optString("t")) {
            "begin" -> transfers.begin(
                id = json.optString("id"),
                name = json.optString("name"),
                mime = json.optString("mime"),
                size = json.optLong("size", -1),
            )
            "chunk" -> {
                val id = json.optString("id")
                val seq = json.optInt("seq", -1)
                transfers.chunk(id, seq, json.optString("data")) { reply.postMessage("$id:$seq") }
            }
            "end" -> transfers.end(json.optString("id"))
            "abort" -> transfers.abort(json.optString("id"))
            "tooLarge" -> transfers.reportFailure(json.optString("name"), "too_large")
            "lost" -> transfers.reportFailure(json.optString("name"), "failed")
            "url" -> emit(
                mapOf(
                    "type" to "fileRequested",
                    "url" to json.optString("url"),
                    "view" to false,
                    "name" to json.optString("name").take(FileTransfers.MAX_NAME_CHARS),
                ),
            )
            "copy" -> {
                val copied = json.optString("text")
                if (copied.isNotEmpty() && copied.length <= MAX_COPY_CHARS) {
                    context.getSystemService(ClipboardManager::class.java)
                        ?.setPrimaryClip(ClipData.newPlainText("Dikho CRM", copied))
                }
            }
            "chrome" -> {
                val top = json.optInt("top", -1)
                val bottom = json.optInt("bottom", -1)
                if (top in 0..0xFFFFFF && bottom in 0..0xFFFFFF) {
                    emit(mapOf("type" to "chrome", "top" to top, "bottom" to bottom))
                }
            }
        }
    }
}
