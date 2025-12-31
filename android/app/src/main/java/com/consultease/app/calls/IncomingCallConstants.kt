package com.consultease.app.calls

object IncomingCallConstants {
  const val CHANNEL_ID = "incoming_calls_ringing_v1"
  const val CHANNEL_NAME = "Incoming calls"

  const val NOTIFICATION_ID = 49210

  const val ACTION_START_RINGING = "com.consultease.app.calls.ACTION_START_RINGING"
  const val ACTION_STOP_RINGING = "com.consultease.app.calls.ACTION_STOP_RINGING"
  const val ACTION_ACCEPT = "com.consultease.app.calls.ACTION_ACCEPT"
  const val ACTION_REJECT = "com.consultease.app.calls.ACTION_REJECT"

  const val EXTRA_CALL_ID = "callId"
  const val EXTRA_CALLER_NAME = "callerName"
  const val EXTRA_TTL_SEC = "ttlSec"
  const val EXTRA_HAS_VIDEO = "hasVideo"
  const val EXTRA_STOP_REASON = "stopReason"

  const val DEFAULT_TTL_SEC = 30
}
