package com.finalapp.vibe2

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap

class ConnectivityModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "FresshConnectivity"

  @ReactMethod
  fun getNetworkSnapshot(promise: Promise) {
    try {
      val connectivityManager = reactContext.getSystemService(
        Context.CONNECTIVITY_SERVICE
      ) as ConnectivityManager
      val activeNetwork = connectivityManager.activeNetwork
      val capabilities = activeNetwork?.let {
        connectivityManager.getNetworkCapabilities(it)
      }
      val transports = WritableNativeArray()

      if (capabilities != null) {
        addTransportIfPresent(
          transports,
          capabilities,
          NetworkCapabilities.TRANSPORT_WIFI,
          "wifi"
        )
        addTransportIfPresent(
          transports,
          capabilities,
          NetworkCapabilities.TRANSPORT_CELLULAR,
          "cellular"
        )
        addTransportIfPresent(
          transports,
          capabilities,
          NetworkCapabilities.TRANSPORT_ETHERNET,
          "ethernet"
        )
        addTransportIfPresent(
          transports,
          capabilities,
          NetworkCapabilities.TRANSPORT_VPN,
          "vpn"
        )
        addTransportIfPresent(
          transports,
          capabilities,
          NetworkCapabilities.TRANSPORT_BLUETOOTH,
          "bluetooth"
        )
      }

      val connected = activeNetwork != null && capabilities != null
      val internetCapable =
        capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
      val validated =
        capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
      val wifiConnected =
        capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true

      promise.resolve(WritableNativeMap().apply {
        putBoolean("connected", connected)
        putBoolean("internetCapable", internetCapable)
        if (validated == null) {
          putNull("validated")
        } else {
          putBoolean("validated", validated)
        }
        putBoolean("wifiConnected", wifiConnected)
        putArray("transports", transports)
      })
    } catch (e: Exception) {
      promise.reject("CONNECTIVITY_SNAPSHOT_FAILED", e)
    }
  }

  private fun addTransportIfPresent(
    transports: WritableNativeArray,
    capabilities: NetworkCapabilities,
    transport: Int,
    name: String
  ) {
    if (capabilities.hasTransport(transport)) {
      transports.pushString(name)
    }
  }
}
