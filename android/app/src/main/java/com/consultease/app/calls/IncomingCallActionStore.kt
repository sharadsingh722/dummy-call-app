package com.consultease.app.calls

import android.content.Context

object IncomingCallActionStore {
  private const val PREFS_NAME = "incoming_call_actions_v1"
  private const val KEY_PENDING = "pending"

  data class PendingAction(val callId: String, val action: String, val timestampMs: Long)

  fun record(context: Context, callId: String, action: String) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val set = (prefs.getStringSet(KEY_PENDING, emptySet()) ?: emptySet()).toMutableSet()
    set.removeIf { it.startsWith("$callId|") }
    set.add("$callId|$action|${System.currentTimeMillis()}")
    prefs.edit().putStringSet(KEY_PENDING, set).apply()
  }

  fun drain(context: Context): List<PendingAction> {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val set = prefs.getStringSet(KEY_PENDING, emptySet()) ?: emptySet()
    prefs.edit().remove(KEY_PENDING).apply()

    val out = mutableListOf<PendingAction>()
    for (raw in set) {
      val parts = raw.split("|")
      if (parts.size < 3) continue
      val callId = parts[0]
      val action = parts[1]
      val ts = parts[2].toLongOrNull() ?: continue
      out.add(PendingAction(callId = callId, action = action, timestampMs = ts))
    }
    return out.sortedBy { it.timestampMs }
  }
}

