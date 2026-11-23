package `in`.dikho.crm

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities

/**
 * Whether the phone can reach the internet, and every change to it, so the app can
 * say "No connection" and "Back online" and a failed load can retry itself.
 *
 * Online means the default network has internet AND Android has validated it, so a
 * Wi-Fi without internet or behind a login page counts as offline.
 */
internal class NetworkWatcher(context: Context, private val onChange: (Boolean) -> Unit) {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)

    @Volatile
    var online: Boolean = currentlyOnline()
        private set

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = update(reachable(capabilities))

        override fun onLost(network: Network) = update(false)
    }

    fun start() = connectivity.registerDefaultNetworkCallback(callback)

    fun stop() = connectivity.unregisterNetworkCallback(callback)

    private fun currentlyOnline(): Boolean {
        val capabilities = connectivity.getNetworkCapabilities(connectivity.activeNetwork ?: return false) ?: return false
        return reachable(capabilities)
    }

    private fun reachable(capabilities: NetworkCapabilities) =
        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)

    private fun update(value: Boolean) {
        if (value == online) return
        online = value
        onChange(value)
    }
}
