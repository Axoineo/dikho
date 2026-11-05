package `in`.dikho.crm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Not exported: only the PendingIntent given to the package installer reaches it. */
class InstallResultReceiver : BroadcastReceiver() {
    internal companion object {
        var handler: ApkInstaller? = null
    }

    override fun onReceive(context: Context, intent: Intent) {
        handler?.onInstallResult(intent)
    }
}
