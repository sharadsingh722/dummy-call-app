package com.consultease.app.calls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.consultease.app.R

class IncomingCallActivity : AppCompatActivity() {
  private var callId: String? = null

  private val dismissReceiver =
    object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        val dismissCallId = intent.getStringExtra(IncomingCallConstants.EXTRA_CALL_ID)
        if (dismissCallId != null && dismissCallId == callId) {
          finishAndRemoveTask()
        }
      }
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    callId = intent.getStringExtra(IncomingCallConstants.EXTRA_CALL_ID)
    val callerName = intent.getStringExtra(IncomingCallConstants.EXTRA_CALLER_NAME) ?: "Unknown"
    val hasVideo = intent.getBooleanExtra(IncomingCallConstants.EXTRA_HAS_VIDEO, false)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD,
      )
    }

    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    setContentView(R.layout.activity_incoming_call)

    findViewById<TextView>(R.id.incoming_call_caller_name).text = callerName
    findViewById<TextView>(R.id.incoming_call_status).text = if (hasVideo) "Incoming video call" else "Incoming call"

    findViewById<Button>(R.id.incoming_call_accept).setOnClickListener {
      val id = callId ?: return@setOnClickListener
      sendBroadcast(
        Intent(this, IncomingCallActionReceiver::class.java).apply {
          action = IncomingCallConstants.ACTION_ACCEPT
          putExtra(IncomingCallConstants.EXTRA_CALL_ID, id)
        },
      )
      finishAndRemoveTask()
    }

    findViewById<Button>(R.id.incoming_call_reject).setOnClickListener {
      val id = callId ?: return@setOnClickListener
      sendBroadcast(
        Intent(this, IncomingCallActionReceiver::class.java).apply {
          action = IncomingCallConstants.ACTION_REJECT
          putExtra(IncomingCallConstants.EXTRA_CALL_ID, id)
        },
      )
      finishAndRemoveTask()
    }
  }

  override fun onStart() {
    super.onStart()
    LocalBroadcastManager.getInstance(this)
      .registerReceiver(dismissReceiver, IntentFilter(ACTION_DISMISS))
  }

  override fun onStop() {
    super.onStop()
    try {
      LocalBroadcastManager.getInstance(this).unregisterReceiver(dismissReceiver)
    } catch (_: Throwable) {}
  }

  companion object {
    const val ACTION_DISMISS = "com.consultease.app.calls.ACTION_DISMISS_INCOMING_CALL_UI"
  }
}

