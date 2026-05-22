package com.finalapp.vibe2

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class SshForegroundService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onCreate() {
    super.onCreate()
    ensureNotificationChannels(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: DEFAULT_TITLE
    val message = intent?.getStringExtra(EXTRA_MESSAGE) ?: DEFAULT_MESSAGE
    startForeground(NOTIFICATION_ID, buildNotification(title, message))
    acquireWakeLock()
    return START_STICKY
  }

  override fun onDestroy() {
    releaseWakeLock()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      stopForeground(true)
    }
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun buildNotification(title: String, message: String): Notification {
    val intent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pendingIntent = PendingIntent.getActivity(
      this,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(message)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = powerManager.newWakeLock(
      PowerManager.PARTIAL_WAKE_LOCK,
      WAKE_LOCK_TAG
    ).apply { setReferenceCounted(false) }
    wakeLock?.acquire()
  }

  private fun releaseWakeLock() {
    try {
      if (wakeLock?.isHeld == true) {
        wakeLock?.release()
      }
    } finally {
      wakeLock = null
    }
  }

  companion object {
    private const val NOTIFICATION_ID = 4227
    private const val CHANNEL_ID = "fressh_ssh"
    private const val CHANNEL_NAME = "Fressh SSH"
    private const val CHANNEL_DESCRIPTION = "Keeps SSH sessions alive"
    private const val AGENT_ALERT_CHANNEL_ID = "fressh_agent_alerts"
    private const val AGENT_ALERT_CHANNEL_NAME = "Fressh Agent Alerts"
    private const val AGENT_ALERT_CHANNEL_DESCRIPTION = "Agent status notifications"
    private const val WAKE_LOCK_TAG = "Fressh::SshForegroundService"
    private const val DEFAULT_TITLE = "Fressh Terminal"
    private const val DEFAULT_MESSAGE = "Keeping SSH connection alive"
    const val EXTRA_TITLE = "title"
    const val EXTRA_MESSAGE = "message"
    const val EXTRA_AGENT_CONNECTION_ID = "agentConnectionId"
    const val EXTRA_AGENT_SESSION = "agentSession"
    const val EXTRA_AGENT_TARGET = "agentTarget"
    const val EXTRA_AGENT_WINDOW_ID = "agentWindowId"

    private fun ensureNotificationChannels(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val channel = NotificationChannel(
        CHANNEL_ID,
        CHANNEL_NAME,
        NotificationManager.IMPORTANCE_LOW
      )
      channel.description = CHANNEL_DESCRIPTION
      manager.createNotificationChannel(channel)

      val alertChannel = NotificationChannel(
        AGENT_ALERT_CHANNEL_ID,
        AGENT_ALERT_CHANNEL_NAME,
        NotificationManager.IMPORTANCE_DEFAULT
      )
      alertChannel.description = AGENT_ALERT_CHANNEL_DESCRIPTION
      manager.createNotificationChannel(alertChannel)
    }

    private fun buildAgentAlertNotification(
      context: Context,
      notificationId: Int,
      title: String,
      message: String,
      connectionId: String,
      session: String,
      target: String,
      windowId: String
    ): Notification {
      val intent = Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        putExtra(EXTRA_AGENT_CONNECTION_ID, connectionId)
        putExtra(EXTRA_AGENT_SESSION, session)
        putExtra(EXTRA_AGENT_TARGET, target)
        putExtra(EXTRA_AGENT_WINDOW_ID, windowId)
      }
      val pendingIntent = PendingIntent.getActivity(
        context,
        notificationId,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )

      return NotificationCompat.Builder(context, AGENT_ALERT_CHANNEL_ID)
        .setContentTitle(title)
        .setContentText(message)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentIntent(pendingIntent)
        .setAutoCancel(true)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .build()
    }

    fun start(context: Context, title: String, message: String) {
      val intent = Intent(context, SshForegroundService::class.java).apply {
        putExtra(EXTRA_TITLE, title)
        putExtra(EXTRA_MESSAGE, message)
      }
      ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context) {
      val intent = Intent(context, SshForegroundService::class.java)
      context.stopService(intent)
    }

    fun postAgentAlert(
      context: Context,
      notificationId: Int,
      title: String,
      message: String,
      connectionId: String,
      session: String,
      target: String,
      windowId: String
    ) {
      ensureNotificationChannels(context)
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.notify(notificationId, buildAgentAlertNotification(
        context,
        notificationId,
        title,
        message,
        connectionId,
        session,
        target,
        windowId
      ))
    }

    fun cancelAgentAlert(context: Context, notificationId: Int) {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.cancel(notificationId)
    }
  }
}
