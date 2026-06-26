package com.finalapp.vibe2

import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap

class TailscaleModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "FresshTailscale"

  @ReactMethod
  fun isAvailable(promise: Promise) {
    promise.resolve(isTailscaleInstalled())
  }

  @ReactMethod
  fun connect(promise: Promise) {
    sendTailscaleBroadcast(ACTION_CONNECT, promise)
  }

  @ReactMethod
  fun disconnect(promise: Promise) {
    sendTailscaleBroadcast(ACTION_DISCONNECT, promise)
  }

  @ReactMethod
  fun openApp(promise: Promise) {
    try {
      val launchIntent = reactContext.packageManager
        .getLaunchIntentForPackage(TAILSCALE_PACKAGE)

      if (launchIntent == null) {
        promise.resolve(attemptResult(false))
        return
      }

      launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactContext.startActivity(launchIntent)
      promise.resolve(attemptResult(true))
    } catch (e: Exception) {
      promise.reject("TAILSCALE_OPEN_FAILED", e)
    }
  }

  private fun sendTailscaleBroadcast(action: String, promise: Promise) {
    try {
      if (!isTailscaleInstalled()) {
        promise.resolve(attemptResult(false))
        return
      }

      val intent = Intent(action).apply {
        component = ComponentName(TAILSCALE_PACKAGE, TAILSCALE_RECEIVER)
      }
      reactContext.sendBroadcast(intent)
      promise.resolve(attemptResult(true))
    } catch (e: Exception) {
      promise.reject("TAILSCALE_BROADCAST_FAILED", e)
    }
  }

  private fun isTailscaleInstalled(): Boolean {
    return try {
      reactContext.packageManager.getPackageInfo(TAILSCALE_PACKAGE, 0)
      true
    } catch (_: PackageManager.NameNotFoundException) {
      false
    }
  }

  private fun attemptResult(attempted: Boolean): WritableNativeMap {
    return WritableNativeMap().apply {
      putBoolean("attempted", attempted)
    }
  }

  companion object {
    private const val TAILSCALE_PACKAGE = "com.tailscale.ipn"
    private const val TAILSCALE_RECEIVER = "com.tailscale.ipn.IPNReceiver"
    private const val ACTION_CONNECT = "com.tailscale.ipn.CONNECT_VPN"
    private const val ACTION_DISCONNECT = "com.tailscale.ipn.DISCONNECT_VPN"
  }
}
