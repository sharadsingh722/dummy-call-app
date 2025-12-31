package com.consultease.app.calls

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.Arguments

class IncomingCallManagerModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "IncomingCallManager"

  @ReactMethod
  fun startRinging(callId: String, callerName: String, ttlSec: Int, hasVideo: Boolean) {
    IncomingCallForegroundService.startRinging(
      reactApplicationContext,
      callId = callId,
      callerName = callerName,
      ttlSec = ttlSec,
      hasVideo = hasVideo,
    )
  }

  @ReactMethod
  fun stopRinging(reason: String) {
    IncomingCallForegroundService.stopRinging(reactApplicationContext, reason)
  }

  @ReactMethod
  fun getAndClearPendingActions(promise: Promise) {
    val actions = IncomingCallActionStore.drain(reactApplicationContext)
    val array = Arguments.createArray()
    for (a in actions) {
      val map = Arguments.createMap()
      map.putString("callId", a.callId)
      map.putString("action", a.action)
      map.putDouble("timestampMs", a.timestampMs.toDouble())
      array.pushMap(map)
    }
    promise.resolve(array)
  }
}
