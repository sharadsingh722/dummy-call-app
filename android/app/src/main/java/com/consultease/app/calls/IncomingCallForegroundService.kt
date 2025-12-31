package com.consultease.app.calls

import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import io.wazo.callkeep.Constants
import io.wazo.callkeep.VoiceConnectionService
import java.util.HashMap

class IncomingCallForegroundService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var timeoutRunnable: Runnable? = null
  private var currentCallId: String? = null
  private var ringtone: Ringtone? = null
  private var audioManager: AudioManager? = null
  private var audioFocusRequest: AudioFocusRequest? = null

  private val callKeepEventsReceiver =
    object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        val callId = currentCallId ?: return
        val action = intent.action ?: return

        val attributeMap =
          (intent.extras?.getSerializable("attributeMap") as? HashMap<*, *>) ?: return
        val eventCallId = (attributeMap[Constants.EXTRA_CALL_UUID] as? String) ?: return
        if (eventCallId != callId) return

        when (action) {
          Constants.ACTION_ANSWER_CALL -> stopRinging("callkeep_answer")
          Constants.ACTION_END_CALL -> stopRinging("callkeep_end")
        }
      }
    }

  override fun onCreate() {
    super.onCreate()
    LocalBroadcastManager.getInstance(this)
      .registerReceiver(
        callKeepEventsReceiver,
        IntentFilter().apply {
          addAction(Constants.ACTION_ANSWER_CALL)
          addAction(Constants.ACTION_END_CALL)
        },
      )
  }

  override fun onDestroy() {
    super.onDestroy()
    try {
      LocalBroadcastManager.getInstance(this).unregisterReceiver(callKeepEventsReceiver)
    } catch (_: Throwable) {}
    cleanup("service_destroyed")
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val action = intent?.action ?: IncomingCallConstants.ACTION_START_RINGING
    when (action) {
      IncomingCallConstants.ACTION_START_RINGING -> {
        val callId = intent?.getStringExtra(IncomingCallConstants.EXTRA_CALL_ID) ?: return START_NOT_STICKY
        val callerName = intent.getStringExtra(IncomingCallConstants.EXTRA_CALLER_NAME) ?: "Unknown"
        val ttlSec = intent.getIntExtra(IncomingCallConstants.EXTRA_TTL_SEC, IncomingCallConstants.DEFAULT_TTL_SEC)
        val hasVideo = intent.getBooleanExtra(IncomingCallConstants.EXTRA_HAS_VIDEO, false)
        startRinging(callId = callId, callerName = callerName, ttlSec = ttlSec, hasVideo = hasVideo)
      }
      IncomingCallConstants.ACTION_STOP_RINGING -> {
        val reason = intent?.getStringExtra(IncomingCallConstants.EXTRA_STOP_REASON) ?: "stop_requested"
        stopRinging(reason)
      }
    }

    return START_NOT_STICKY
  }

  private fun startRinging(callId: String, callerName: String, ttlSec: Int, hasVideo: Boolean) {
    if (currentCallId != null && currentCallId != callId) {
      cleanup("replaced_by_new_invite")
    }
    currentCallId = callId

    IncomingCallNotification.ensureChannel(this)
    val notification = IncomingCallNotification.buildRingingNotification(this, callId, callerName, hasVideo)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(IncomingCallConstants.NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
    } else {
      startForeground(IncomingCallConstants.NOTIFICATION_ID, notification)
    }

    startRingtone()
    scheduleTimeout(if (ttlSec >= 5) ttlSec else IncomingCallConstants.DEFAULT_TTL_SEC)
  }

  private fun scheduleTimeout(ttlSec: Int) {
    timeoutRunnable?.let { handler.removeCallbacks(it) }
    val runnable =
      Runnable {
        val callId = currentCallId ?: return@Runnable
        Log.i("IncomingCallFGS", "timeout callId=$callId ttlSec=$ttlSec")
        IncomingCallActionStore.record(this, callId, "missed")
        markMissed(callId)
        stopRinging("timeout")
      }
    timeoutRunnable = runnable
    handler.postDelayed(runnable, (ttlSec.coerceAtLeast(5) * 1000L))
  }

  private fun startRingtone() {
    try {
      audioManager = getSystemService(AudioManager::class.java)
      val attrs =
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        audioFocusRequest =
          AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .setAudioAttributes(attrs)
            .setOnAudioFocusChangeListener { /* no-op */ }
            .build()
        audioManager?.requestAudioFocus(audioFocusRequest!!)
      } else {
        @Suppress("DEPRECATION")
        audioManager?.requestAudioFocus(null, AudioManager.STREAM_RING, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
      }

      val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
      val r = RingtoneManager.getRingtone(this, uri)
      r.audioAttributes = attrs
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        r.isLooping = true
      }
      ringtone = r
      r.play()
    } catch (t: Throwable) {
      Log.w("IncomingCallFGS", "startRingtone failed: ${t.message}", t)
    }
  }

  private fun stopRinging(reason: String) {
    cleanup(reason)
    stopSelf()
  }

  private fun cleanup(reason: String) {
    Log.i("IncomingCallFGS", "stopRinging reason=$reason callId=$currentCallId")

    timeoutRunnable?.let { handler.removeCallbacks(it) }
    timeoutRunnable = null

    try {
      ringtone?.stop()
    } catch (_: Throwable) {}
    ringtone = null

    try {
      val am = audioManager
      val req = audioFocusRequest
      if (am != null) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && req != null) {
          am.abandonAudioFocusRequest(req)
        } else {
          @Suppress("DEPRECATION")
          am.abandonAudioFocus(null)
        }
      }
    } catch (_: Throwable) {}
    audioFocusRequest = null
    audioManager = null

    try {
      LocalBroadcastManager.getInstance(this)
        .sendBroadcast(Intent(IncomingCallActivity.ACTION_DISMISS).putExtra(IncomingCallConstants.EXTRA_CALL_ID, currentCallId))
    } catch (_: Throwable) {}

    try {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } catch (_: Throwable) {}

    currentCallId = null
  }

  private fun markMissed(callId: String) {
    try {
      val conn = VoiceConnectionService.getConnection(callId)
      if (conn is io.wazo.callkeep.VoiceConnection) {
        conn.reportDisconnect(6)
      } else {
        conn?.onDisconnect()
      }
    } catch (t: Throwable) {
      Log.w("IncomingCallFGS", "markMissed failed: ${t.message}", t)
    }
  }

  companion object {
    fun startRinging(
      context: Context,
      callId: String,
      callerName: String,
      ttlSec: Int,
      hasVideo: Boolean,
    ) {
      val intent =
        Intent(context, IncomingCallForegroundService::class.java).apply {
          action = IncomingCallConstants.ACTION_START_RINGING
          putExtra(IncomingCallConstants.EXTRA_CALL_ID, callId)
          putExtra(IncomingCallConstants.EXTRA_CALLER_NAME, callerName)
          putExtra(IncomingCallConstants.EXTRA_TTL_SEC, ttlSec)
          putExtra(IncomingCallConstants.EXTRA_HAS_VIDEO, hasVideo)
        }
      ContextCompat.startForegroundService(context, intent)
    }

    fun stopRinging(context: Context, reason: String) {
      Log.i("IncomingCallFGS", "stopRinging requested reason=$reason")
      context.stopService(Intent(context, IncomingCallForegroundService::class.java))
    }
  }
}
