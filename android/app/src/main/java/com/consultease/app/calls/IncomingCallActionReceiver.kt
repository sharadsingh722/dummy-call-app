package com.consultease.app.calls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.consultease.app.MainActivity
import io.wazo.callkeep.VoiceConnectionService

class IncomingCallActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val callId = intent.getStringExtra(IncomingCallConstants.EXTRA_CALL_ID) ?: return
    when (intent.action) {
      IncomingCallConstants.ACTION_ACCEPT -> {
        Log.i("IncomingCallAction", "ACCEPT callId=$callId")
        IncomingCallActionStore.record(context, callId, "accept")
        try {
          VoiceConnectionService.getConnection(callId)?.onAnswer()
        } catch (t: Throwable) {
          Log.w("IncomingCallAction", "onAnswer failed: ${t.message}", t)
        }
        IncomingCallForegroundService.stopRinging(context, "accepted")
        bringAppToForeground(context, callId, "accept")
      }
      IncomingCallConstants.ACTION_REJECT -> {
        Log.i("IncomingCallAction", "REJECT callId=$callId")
        IncomingCallActionStore.record(context, callId, "decline")
        try {
          VoiceConnectionService.getConnection(callId)?.onReject()
        } catch (t: Throwable) {
          Log.w("IncomingCallAction", "onReject failed: ${t.message}", t)
        }
        IncomingCallForegroundService.stopRinging(context, "rejected")
      }
    }
  }

  private fun bringAppToForeground(context: Context, callId: String, action: String) {
    try {
      val launchIntent =
        Intent(context, MainActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
          putExtra(IncomingCallConstants.EXTRA_CALL_ID, callId)
          putExtra("callAction", action)
        }
      context.startActivity(launchIntent)
    } catch (t: Throwable) {
      Log.w("IncomingCallAction", "bringAppToForeground failed: ${t.message}", t)
    }
  }
}
