package com.consultease.app.calls

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import com.consultease.app.R

object IncomingCallNotification {
  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val channel =
      NotificationChannel(
          IncomingCallConstants.CHANNEL_ID,
          IncomingCallConstants.CHANNEL_NAME,
          NotificationManager.IMPORTANCE_HIGH,
        )
        .apply {
          description = "Incoming call alerts"
          setSound(null, null)
          enableVibration(true)
          vibrationPattern = longArrayOf(0, 1200, 800, 1200, 800)
          lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
        }

    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(channel)
  }

  fun buildRingingNotification(
    context: Context,
    callId: String,
    callerName: String,
    hasVideo: Boolean,
  ): android.app.Notification {
    val acceptIntent =
      Intent(context, IncomingCallActionReceiver::class.java).apply {
        action = IncomingCallConstants.ACTION_ACCEPT
        putExtra(IncomingCallConstants.EXTRA_CALL_ID, callId)
      }
    val rejectIntent =
      Intent(context, IncomingCallActionReceiver::class.java).apply {
        action = IncomingCallConstants.ACTION_REJECT
        putExtra(IncomingCallConstants.EXTRA_CALL_ID, callId)
      }

    val acceptPendingIntent =
      PendingIntent.getBroadcast(
        context,
        (callId.hashCode() * 31 + 1),
        acceptIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or pendingIntentImmutableFlag(),
      )
    val rejectPendingIntent =
      PendingIntent.getBroadcast(
        context,
        (callId.hashCode() * 31 + 2),
        rejectIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or pendingIntentImmutableFlag(),
      )

    val fullScreenIntent =
      Intent(context, IncomingCallActivity::class.java).apply {
        putExtra(IncomingCallConstants.EXTRA_CALL_ID, callId)
        putExtra(IncomingCallConstants.EXTRA_CALLER_NAME, callerName)
        putExtra(IncomingCallConstants.EXTRA_HAS_VIDEO, hasVideo)
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      }
    val fullScreenPendingIntent =
      PendingIntent.getActivity(
        context,
        callId.hashCode(),
        fullScreenIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or pendingIntentImmutableFlag(),
      )

    val person = Person.Builder().setName(callerName).setImportant(true).build()
    val callText = if (hasVideo) "Incoming video call" else "Incoming call"

    val builder =
      NotificationCompat.Builder(context, IncomingCallConstants.CHANNEL_ID)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle(callerName)
        .setContentText(callText)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setOngoing(true)
        .setAutoCancel(false)
        .setOnlyAlertOnce(false)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setFullScreenIntent(fullScreenPendingIntent, true)
        .setContentIntent(fullScreenPendingIntent)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .setColor(0xFF25D366.toInt())
        .setColorized(true)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      try {
        builder.setStyle(
          NotificationCompat.CallStyle.forIncomingCall(person, rejectPendingIntent, acceptPendingIntent),
        )
      } catch (_: Throwable) {}
    } else {
      // Pre-Android 12: keep it simple (exactly two actions).
      builder.setStyle(NotificationCompat.BigTextStyle().bigText(callText))
      builder.addAction(R.drawable.ic_decline, "Decline", rejectPendingIntent)
      builder.addAction(R.drawable.ic_accept, "Answer", acceptPendingIntent)
    }

    return builder.build()
  }

  private fun pendingIntentImmutableFlag(): Int {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
  }
}
