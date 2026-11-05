package `in`.dikho.crm

import android.app.Activity
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.pm.PackageInfoCompat
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * Installs the app's own update through Android's package installer. Android
 * always shows the person its confirmation screen, and it refuses an APK signed
 * by a different key: this code cannot bypass either, and does not try to.
 */
internal class ApkInstaller(
    private val context: Context,
    private val emit: (Map<String, Any?>) -> Unit,
    private val activity: () -> Activity?,
) {
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    /**
     * Calls back with null when the file is this app, the advertised version,
     * newer than what is installed and signed by the same key. Android makes
     * the same signer check at install time. Doing it first gives a clear
     * message instead of a generic installer failure.
     */
    fun verify(path: String, expectedVersionCode: Long, callback: (String?) -> Unit) {
        io.execute {
            val rejected = try {
                rejection(path, expectedVersionCode)
            } catch (_: Exception) {
                "unreadable"
            }
            main.post { callback(rejected) }
        }
    }

    private fun rejection(path: String, expectedVersionCode: Long): String? {
        val manager = context.packageManager
        val archive = manager.getPackageArchiveInfo(path, signatureFlags())
            ?: return "unreadable"
        if (archive.packageName != context.packageName) return "package"
        val code = PackageInfoCompat.getLongVersionCode(archive)
        if (code != expectedVersionCode) return "version"
        val installed = manager.getPackageInfo(context.packageName, signatureFlags())
        if (code <= PackageInfoCompat.getLongVersionCode(installed)) return "not_newer"

        val installedSigners = signerDigests(installed)
        val archiveSigners = signerDigests(archive)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P && archiveSigners.isEmpty()) {
            // Older Android may not report an archive's signers. It still
            // enforces them when installing, so this is not a way around it.
            return null
        }
        return if (installedSigners.intersect(archiveSigners).isEmpty()) "signer" else null
    }

    @Suppress("DEPRECATION")
    private fun signatureFlags(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            PackageManager.GET_SIGNATURES
        }

    @Suppress("DEPRECATION")
    private fun signerDigests(info: PackageInfo): Set<String> {
        val signatures: Array<Signature>? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.signingInfo?.signingCertificateHistory ?: info.signingInfo?.apkContentsSigners
        } else {
            info.signatures
        }
        return signatures.orEmpty().map { signature ->
            MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).joinToString("") { "%02x".format(it) }
        }.toSet()
    }

    /** Android 7 has no per-app permission: its installer checks the global setting. */
    fun canInstall(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    fun openPermissionSettings() {
        val intent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}"),
        )
        val host = activity()
        if (host != null) host.startActivity(intent) else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    fun install(path: String) {
        io.execute {
            try {
                commit(File(path))
            } catch (_: Exception) {
                // Including the installer's own runtime exceptions. The dialog
                // then offers a retry rather than the app dying mid-update.
                emit(mapOf("type" to "installStatus", "status" to "failed"))
            }
        }
    }

    private fun commit(apk: File) {
        val installer = context.packageManager.packageInstaller
        // A session left behind by an earlier attempt that never finished.
        installer.mySessions.forEach { stale ->
            try {
                installer.abandonSession(stale.sessionId)
            } catch (_: SecurityException) {
                // Already gone.
            }
        }
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(apk.length())
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            apk.inputStream().use { input ->
                session.openWrite("update.apk", 0, apk.length()).use { output ->
                    input.copyTo(output)
                    session.fsync(output)
                }
            }
            // Mutable because the installer adds the status extras. Explicit to
            // this app's own non-exported receiver.
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
            val result = PendingIntent.getBroadcast(
                context,
                sessionId,
                Intent(context, InstallResultReceiver::class.java).setPackage(context.packageName),
                flags,
            )
            session.commit(result.intentSender)
        }
    }

    /** Runs on the main thread, from [InstallResultReceiver]. */
    fun onInstallResult(intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                val host = activity()
                if (confirm != null) {
                    if (host != null) {
                        host.startActivity(confirm)
                    } else {
                        context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                }
                emit(mapOf("type" to "installStatus", "status" to "pendingUser"))
            }
            PackageInstaller.STATUS_SUCCESS -> emit(mapOf("type" to "installStatus", "status" to "success"))
            PackageInstaller.STATUS_FAILURE_ABORTED -> emit(mapOf("type" to "installStatus", "status" to "cancelled"))
            else -> emit(mapOf("type" to "installStatus", "status" to "failed"))
        }
    }
}
