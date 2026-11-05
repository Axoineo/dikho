package `in`.dikho.crm

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.database.sqlite.SQLiteException
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.webkit.MimeTypeMap
import android.webkit.URLUtil
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executor
import java.util.concurrent.Executors

/**
 * Receives files from the page or a signed link and puts them where Android
 * wants them: Downloads when saving, a private cache plus a FileProvider grant
 * when viewing. Needs no storage permission on any Android version.
 */
internal class FileTransfers(
    private val context: Context,
    private val emit: (Map<String, Any?>) -> Unit,
    private val createDocument: (String, String, (Uri?) -> Unit) -> Unit,
    private val activity: () -> Activity?,
) {
    companion object {
        const val MAX_NAME_CHARS = 120
        private const val MAX_BLOB_BYTES = 100L * 1024 * 1024
        private const val MAX_FETCH_BYTES = 200L * 1024 * 1024
        private const val MAX_ACTIVE = 3
        private const val MAX_REDIRECTS = 5
        private const val STALE_AFTER_MS = 60 * 60 * 1000L
        private const val APK_MIME = "application/vnd.android.package-archive"
        private const val SUBFOLDER = "Dikho CRM"
        private const val MAX_NAME_ATTEMPTS = 20
    }

    private class Incoming(val file: File, val name: String, val mime: String, val size: Long) {
        var received = 0L
        var nextSeq = 0
    }

    // One thread: chunks stay in order, and disk work stays off the UI thread.
    private val io = Executors.newSingleThreadExecutor()

    // Separate, so a slow link never holds up the chunks of a file from the page.
    private val network = Executors.newFixedThreadPool(2)
    private val main = Handler(Looper.getMainLooper())
    private val active = HashMap<String, Incoming>()

    /** Set only by local test builds. */
    var forceSaveDialog = false

    private val transferDir get() = File(context.cacheDir, "transfers").apply { mkdirs() }
    private val sharedDir get() = File(context.cacheDir, "shared").apply { mkdirs() }

    /**
     * Every background job runs through here. An exception that escapes an
     * executor thread would end the whole process, and with it the CRM session on
     * screen, so the worst a failed file can do is show a message.
     */
    private fun background(name: String, thread: Executor = io, work: () -> Unit) {
        thread.execute {
            try {
                work()
            } catch (_: Exception) {
                reportFailure(name, "failed")
            }
        }
    }

    /* ── From the page (blob: and data: links) ────────────────────────── */

    fun begin(id: String, name: String, mime: String, size: Long) {
        val safeName = safeFileName(name, "download")
        val safeMime = normalizedMime(mime, safeName)
        background(safeName) {
            if (id.isEmpty() || id.length > 16 || active.containsKey(id) || active.size >= MAX_ACTIVE) {
                reportFailure(safeName, "failed")
                return@background
            }
            if (size !in 0..MAX_BLOB_BYTES) {
                reportFailure(safeName, "too_large")
                return@background
            }
            active[id] = Incoming(File(transferDir, UUID.randomUUID().toString()), safeName, safeMime, size)
            emit(mapOf("type" to "downloadStarted", "name" to safeName))
        }
    }

    fun chunk(id: String, seq: Int, base64: String, acknowledge: () -> Unit) {
        background("the file") {
            val incoming = active[id] ?: return@background
            try {
                if (seq != incoming.nextSeq) throw IOException("out of order")
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                incoming.received += bytes.size
                if (incoming.received > incoming.size) throw IOException("more than declared")
                FileOutputStream(incoming.file, true).use { it.write(bytes) }
                incoming.nextSeq++
                main.post(acknowledge)
            } catch (_: IllegalArgumentException) {
                fail(id, incoming, "failed")
            } catch (_: IOException) {
                fail(id, incoming, "storage")
            }
        }
    }

    fun end(id: String) {
        background("the file") {
            val incoming = active.remove(id) ?: return@background
            if (incoming.received != incoming.size) {
                incoming.file.delete()
                reportFailure(incoming.name, "failed")
                return@background
            }
            if (incoming.size == 0L) incoming.file.createNewFile()
            saveToDownloads(incoming.file, incoming.name, incoming.mime)
        }
    }

    fun abort(id: String) {
        background("the file") {
            active.remove(id)?.let { fail(id, it, "failed") }
        }
    }

    private fun fail(id: String, incoming: Incoming, reason: String) {
        active.remove(id)
        incoming.file.delete()
        reportFailure(incoming.name, reason)
    }

    fun reportFailure(name: String, reason: String) {
        emit(mapOf("type" to "downloadFailed", "name" to safeFileName(name, "the file"), "reason" to reason))
    }

    /* ── From a signed or ticketed link ───────────────────────────────── */

    /**
     * Sends no cookie or token: these links carry their own authority, so a
     * link pointing somewhere unexpected learns nothing. The Dart policy has
     * already accepted the host before this runs.
     */
    fun fetch(url: String, view: Boolean, name: String?, mime: String?, contentDisposition: String?) {
        background(name ?: "the file", network) {
            val temp = File(transferDir, UUID.randomUUID().toString())
            var label = safeFileName(name, "download")
            try {
                val connection = open(url)
                try {
                    val type = connection.contentType ?: mime
                    val disposition = connection.getHeaderField("Content-Disposition") ?: contentDisposition
                    if (name.isNullOrBlank()) {
                        label = safeFileName(URLUtil.guessFileName(url, disposition, type), "download")
                    }
                    val declared = connection.contentLengthLong
                    if (declared > MAX_FETCH_BYTES) throw TooLarge()
                    emit(mapOf("type" to "downloadStarted", "name" to label))
                    connection.inputStream.use { input ->
                        FileOutputStream(temp).use { output ->
                            val buffer = ByteArray(64 * 1024)
                            var total = 0L
                            while (true) {
                                val read = input.read(buffer)
                                if (read < 0) break
                                total += read
                                if (total > MAX_FETCH_BYTES) throw TooLarge()
                                output.write(buffer, 0, read)
                            }
                        }
                    }
                    val finalMime = normalizedMime(type?.substringBefore(';').orEmpty(), label)
                    if (view) showInViewer(temp, label, finalMime) else saveToDownloads(temp, label, finalMime)
                } finally {
                    connection.disconnect()
                }
            } catch (_: TooLarge) {
                temp.delete()
                reportFailure(label, "too_large")
            } catch (_: Expired) {
                temp.delete()
                reportFailure(label, "expired")
            } catch (_: IOException) {
                temp.delete()
                reportFailure(label, "failed")
            } catch (_: IllegalArgumentException) {
                temp.delete()
                reportFailure(label, "failed")
            }
        }
    }

    private class TooLarge : Exception()
    private class Expired : Exception()

    private fun open(start: String): HttpURLConnection {
        var url = URL(start)
        repeat(MAX_REDIRECTS + 1) {
            val localTest = url.protocol == "http" && url.host == "localhost"
            if (url.protocol != "https" && !localTest) throw IOException("not https")
            val connection = url.openConnection() as HttpURLConnection
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.setRequestProperty("Accept-Encoding", "identity")
            val status = connection.responseCode
            when {
                status == HttpURLConnection.HTTP_OK -> return connection
                status in 300..399 -> {
                    val next = connection.getHeaderField("Location")
                    connection.disconnect()
                    url = URL(url, next ?: throw IOException("redirect without target"))
                }
                status == 400 || status == 401 || status == 403 || status == 404 || status == 410 -> {
                    connection.disconnect()
                    throw Expired()
                }
                else -> {
                    connection.disconnect()
                    throw IOException("status $status")
                }
            }
        }
        throw IOException("too many redirects")
    }

    /* ── Where files end up ───────────────────────────────────────────── */

    private fun saveToDownloads(temp: File, name: String, mime: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !forceSaveDialog) {
            saveWithMediaStore(temp, name, mime)
        } else {
            // Android 7 to 9 have no MediaStore Downloads. The system's save
            // dialog needs no permission, where shared storage would need one.
            main.post {
                createDocument(name, mime) { target ->
                    background(name) { saveWithDocument(temp, target, name, mime) }
                }
            }
        }
    }

    private fun saveWithMediaStore(temp: File, name: String, mime: String) {
        val resolver = context.contentResolver
        var item: Uri? = null
        try {
            item = insertDownload(name, mime)
            (resolver.openOutputStream(item) ?: throw IOException("no stream")).use { output ->
                temp.inputStream().use { it.copyTo(output) }
            }
            emit(mapOf("type" to "downloadFinished", "name" to savedName(item, name), "uri" to item.toString(), "mime" to mime))
        } catch (_: Exception) {
            // Anything the media provider throws, not only I/O: the provider's own
            // exceptions cross into this process and must not take the app down.
            item?.let { runCatching { resolver.delete(it, null, null) } }
            reportFailure(name, "storage")
        } finally {
            temp.delete()
        }
    }

    /**
     * Android picks a free name itself, except when a row it cannot match to a file
     * still holds the name, for example from before a reinstall. It refuses that at
     * this step, before anything has been written, so trying the next number is safe.
     *
     * Deliberately not IS_PENDING. The copy comes from a finished local file, so the
     * window it protects is tiny, and clearing the flag is where that refusal would
     * otherwise land, after Android has already moved the file onto the taken name.
     */
    private fun insertDownload(name: String, mime: String): Uri {
        var candidate = name
        var attempt = 0
        while (true) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, candidate)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/$SUBFOLDER")
            }
            try {
                return context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: throw IOException("no MediaStore item")
            } catch (error: SQLiteException) {
                attempt++
                if (attempt > MAX_NAME_ATTEMPTS) throw error
                candidate = numberedName(name, attempt)
            }
        }
    }

    /** The name Android actually used, which may have gained a number. */
    private fun savedName(item: Uri, fallback: String): String {
        val projection = arrayOf(MediaStore.MediaColumns.DISPLAY_NAME)
        return context.contentResolver.query(item, projection, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        } ?: fallback
    }

    private fun numberedName(name: String, number: Int): String {
        val dot = name.lastIndexOf('.')
        return if (dot > 0) "${name.take(dot)} ($number)${name.drop(dot)}" else "$name ($number)"
    }

    private fun saveWithDocument(temp: File, target: Uri?, name: String, mime: String) {
        try {
            if (target == null) {
                // The person cancelled the save dialog.
                emit(mapOf("type" to "downloadCleared"))
                return
            }
            (context.contentResolver.openOutputStream(target) ?: throw IOException("no stream")).use { output ->
                temp.inputStream().use { it.copyTo(output) }
            }
            emit(mapOf("type" to "downloadFinished", "name" to name, "uri" to target.toString(), "mime" to mime))
        } catch (_: Exception) {
            reportFailure(name, "storage")
        } finally {
            temp.delete()
        }
    }

    private fun showInViewer(temp: File, name: String, mime: String) {
        val folder = File(sharedDir, UUID.randomUUID().toString()).apply { mkdirs() }
        val file = File(folder, name)
        if (!temp.renameTo(file)) {
            temp.delete()
            reportFailure(name, "storage")
            return
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        main.post {
            if (open(uri.toString(), mime)) {
                emit(mapOf("type" to "downloadCleared"))
            } else {
                emit(mapOf("type" to "viewFailed", "name" to name, "uri" to uri.toString(), "mime" to mime))
            }
        }
    }

    /**
     * This app may ask Android to install packages, for its own updates. That
     * must never extend to a file that came from a page or an email, so an APK
     * can be saved but is not opened from here.
     */
    fun open(uri: String, mime: String): Boolean {
        if (mime.equals(APK_MIME, ignoreCase = true)) return false
        return launch(Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(uri), mime))
    }

    fun share(uri: String, mime: String): Boolean {
        val parsed = Uri.parse(uri)
        // The grant has to be on the shared intent itself. The chooser copies it.
        val send = Intent(Intent.ACTION_SEND)
            .setType(mime)
            .putExtra(Intent.EXTRA_STREAM, parsed)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri(null, parsed)
        return launch(Intent.createChooser(send, null))
    }

    private fun launch(intent: Intent): Boolean {
        val host = activity() ?: return false
        return try {
            host.startActivity(intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }

    /** Viewed files are private copies. They should not outlive being looked at. */
    fun removeStaleFiles() {
        background("the file") {
            val cutoff = System.currentTimeMillis() - STALE_AFTER_MS
            for (dir in listOf(transferDir, sharedDir)) {
                dir.listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.deleteRecursively() }
            }
        }
    }

    private fun normalizedMime(raw: String, name: String): String {
        val mime = raw.trim().lowercase()
        val usable = Regex("^[a-z0-9.+-]+/[a-z0-9.+-]+$").matches(mime) && mime != "application/octet-stream"
        if (usable) return mime
        val extension = name.substringAfterLast('.', "").lowercase()
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: "application/octet-stream"
    }

    /** Filenames come from the page or a header: strip anything path-like. */
    private fun safeFileName(raw: String?, fallback: String): String {
        val base = raw.orEmpty().replace('\\', '/').substringAfterLast('/')
        val cleaned = base.replace(Regex("[\\p{Cntrl}:*?\"<>|]"), "_").trim().trimStart('.')
        if (cleaned.isEmpty()) return fallback
        if (cleaned.length <= MAX_NAME_CHARS) return cleaned
        val extension = cleaned.substringAfterLast('.', "").take(10)
        val keep = MAX_NAME_CHARS - extension.length - 1
        return if (extension.isEmpty()) cleaned.take(MAX_NAME_CHARS) else "${cleaned.take(keep)}.$extension"
    }
}
