package `in`.dikho.crm

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import android.provider.OpenableColumns
import java.io.File
import java.util.UUID

/**
 * What the native screens need from the phone itself. None of it is reachable from
 * web content: [WebViewBridge] has no path to any of this, so a page can never read
 * contacts or place a call.
 */
internal class DeviceFeatures(private val context: Context) {
    private companion object {
        const val MAX_CONTACT_ROWS = 50_000
        const val MAX_PICKED_BYTES = 100L * 1024 * 1024
        val DIALABLE = Regex("^\\+?[0-9]{3,16}$")
    }

    /**
     * Names and numbers only, flat, as [name, number, name, number...]. No photos,
     * emails or notes are read, and nothing leaves the phone from here.
     */
    fun readContacts(): List<String> {
        if (context.checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            return emptyList()
        }
        val rows = ArrayList<String>()
        context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY,
                ContactsContract.CommonDataKinds.Phone.NUMBER,
            ),
            null,
            null,
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY} COLLATE NOCASE ASC",
        )?.use { cursor ->
            while (cursor.moveToNext() && rows.size < MAX_CONTACT_ROWS * 2) {
                val number = cursor.getString(1) ?: continue
                rows.add(cursor.getString(0).orEmpty())
                rows.add(number)
            }
        }
        return rows
    }

    /**
     * Calls straight away when the person allowed it, otherwise opens the dialer with
     * the number filled in. Only ever a plain number, built with [Uri.fromParts] so it
     * cannot carry anything else. Returns "call", "dial" or null.
     */
    fun placeCall(activity: Activity?, number: String): String? {
        val host = activity ?: return null
        if (!DIALABLE.matches(number)) return null
        val allowed = context.checkSelfPermission(Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED
        val action = if (allowed) Intent.ACTION_CALL else Intent.ACTION_DIAL
        return try {
            host.startActivity(Intent(action, Uri.fromParts("tel", number, null)))
            if (allowed) "call" else "dial"
        } catch (_: ActivityNotFoundException) {
            null
        } catch (_: SecurityException) {
            null
        }
    }

    /**
     * Copies a file the person picked into private cache storage, so it can be read
     * after the picker's grant ends. Null if it is not a picked document or too large.
     */
    fun copyPicked(raw: String): Map<String, Any?>? {
        val uri = Uri.parse(raw)
        if (uri.scheme != "content") return null
        val resolver = context.contentResolver
        var name = "file"
        var size = -1L
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                cursor.getString(0)?.let { name = it }
                if (!cursor.isNull(1)) size = cursor.getLong(1)
            }
        }
        if (size > MAX_PICKED_BYTES) return mapOf("tooLarge" to true)
        val dir = File(context.cacheDir, "outgoing").apply { mkdirs() }
        val target = File(dir, UUID.randomUUID().toString())
        var copied = 0L
        val input = resolver.openInputStream(uri) ?: return null
        input.use { source ->
            target.outputStream().use { sink ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val read = source.read(buffer)
                    if (read < 0) break
                    copied += read
                    if (copied > MAX_PICKED_BYTES) {
                        target.delete()
                        return mapOf("tooLarge" to true)
                    }
                    sink.write(buffer, 0, read)
                }
            }
        }
        return mapOf(
            "path" to target.path,
            "name" to name.take(200),
            "mime" to (resolver.getType(uri) ?: "application/octet-stream"),
            "size" to copied,
        )
    }
}
