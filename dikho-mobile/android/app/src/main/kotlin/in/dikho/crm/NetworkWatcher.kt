package `in`.dikho.crm

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network

/** Reports when a network becomes available, so a failed load can retry itself. */
internal class NetworkWatcher(context: Context, private val onAvailable: () -> Unit) {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = onAvailable()
    }

    fun start() = connectivity.registerDefaultNetworkCallback(callback)

    fun stop() = connectivity.unregisterNetworkCallback(callback)
}
