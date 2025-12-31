# PRD: Firebase Call Notifications (Android, React Native CLI)

**Owner:** Sharad  
**Status:** Draft  
**Last updated:** 2025-12-30  

## Overview
Receive **incoming call invites** via **FCM data-only** messages and present them like WhatsApp on Android:
- Persistent incoming-call notification with **Answer / Decline**
- **Full-screen incoming UI** (lock-screen capable) via `fullScreenIntent`
- **System call registration** via CallKeep (Android `ConnectionService` / `Telecom`)
- **System default ringtone** for the whole ringing duration

This PRD documents the final implementation currently in `MyApp/`.

## Goals
- Handle FCM **data-only** call invites (no notification payload).
- Register the invite as a **call** in Android system UI (CallKeep/Telecom).
- Show a call-style incoming notification that:
  - category `CALL`
  - importance `HIGH`
  - `ongoing=true`, `autoCancel=false`
  - stays visible for the entire ringing duration using a **Foreground Service** (`startForeground`).
- Play the **system default ringtone** while ringing.
- Provide reliable, idempotent **Answer / Decline** from:
  - Notification actions
  - Full-screen incoming UI buttons
  - CallKeep UI
- Support Android **10–14**.

## Non-goals (for this phase)
- RTC media (WebRTC), audio routing, speaker/BT controls, in-call audio.
- iOS incoming call (CallKit / VoIP push).
- Call history UI and missed-call summaries.

## Key product requirements
### Incoming call behavior
- On invite receipt:
  - user sees an incoming call notification (and full-screen UI when allowed)
  - ringtone plays until Answer/Decline/Timeout
  - actions work without opening the app first

### Accept / Decline logic (production-grade)
- State machine:
  - `idle` → `ringing` → (`accepted` | `declined` | `missed`) → `ended`
- Idempotency:
  - keyed by `callId`
  - duplicate invites and repeated taps do not send duplicate backend callbacks
  - backend failures enqueue retries (bounded backoff)
- Timeout:
  - default ringing window is **30s** if `ttlSec` not provided (clamped 5–120s)
- Concurrency:
  - minimal policy: if already `ringing`/`accepted`, ignore new invites (busy)

## Technical approach (Android)
### Libraries (implemented)
- Firebase: `@react-native-firebase/app`, `@react-native-firebase/messaging`
- Call registration/UI: `react-native-callkeep` (Android `ConnectionService` + `TelecomManager`)
- Persistent notification + ringtone: **native Android Foreground Service** (Kotlin)

### Why Foreground Service (FGS)
Android does not allow an app to keep the **heads-up banner** pinned indefinitely. The correct, production-grade persistence mechanism is:
- ongoing notification + foreground service (`startForeground`)
- optional full-screen UI for lock screen / immediate attention

### Notification UI (WhatsApp-like)
- Android 12+ uses `NotificationCompat.CallStyle.forIncomingCall(...)` so the UI is call-shaped with exactly **Answer / Decline**.
- Android 10/11 uses a normal notification with exactly **two actions** (Answer / Decline).

### Ringtone
To guarantee system ringtone behavior consistently across OEMs and OS versions:
- notification channel is silent
- Foreground Service plays the **system default ringtone** via `RingtoneManager.TYPE_RINGTONE` and holds transient audio focus

### Action sync (Notification ↔ CallKeep ↔ JS)
Accept/Decline can happen when JS is not running (e.g., notification action receiver). Native code persists actions and JS replays them:
- Native persists pending actions in `SharedPreferences` (`IncomingCallActionStore`)
- JS drains them on boot via `NativeModules.IncomingCallManager.getAndClearPendingActions()`

## FCM payload contract (from backend)
Backend must send **high priority** (Android) and include a **data payload**.

**Required fields**
- `type`: `"call_invite"`
- `callId`: stable unique id (UUID recommended)
- `callerName`: display string
- `timestampMs`: server time (ms)

**Recommended fields**
- `ttlSec`: invite TTL (default 30)
- `actionEndpoint`: optional override for accept/decline callback

**Example**
```json
{
  "type": "call_invite",
  "callId": "9a5b1f2c-5b9a-4f12-8f5f-9e6d7b1b2c3d",
  "callerName": "Alice",
  "timestampMs": "1735480000000",
  "ttlSec": "30"
}
```

Notes:
- Values may arrive as strings; client parses defensively.
- If `ttlSec` is missing/invalid, client defaults to **30s**.

## Client flows
### Flow A: Invite received (foreground)
1. `messaging().onMessage(...)` receives `call_invite`.
2. `CallService.handleIncomingInvite(...)`:
   - Registers incoming call via CallKeep (`displayIncomingCall`)
   - Starts native Foreground Service to show the persistent call notification + ringtone
3. JS schedules a missed timeout (idempotent safety).

### Flow B: Invite received (background/killed)
1. `setBackgroundMessageHandler(...)` receives the data message (best-effort).
2. Same `CallService.handleIncomingInvite(...)` flow is executed.
3. If user taps Answer/Decline while JS is not running, native persists the action and JS applies it on next boot.

### Flow C: User taps Answer
1. Native answers/reports answer via CallKeep/Telecom.
2. Foreground Service stops and notification is removed.
3. JS marks `accepted` and notifies backend (idempotent + retry).

### Flow D: User taps Decline
1. Native rejects/ends via CallKeep/Telecom.
2. Foreground Service stops and notification is removed.
3. JS marks `declined` and notifies backend (idempotent + retry).

### Flow E: Timeout (missed)
1. If still ringing after TTL, native marks missed and stops the Foreground Service.
2. JS marks `missed` and optionally notifies backend (idempotent + retry).

## Android configuration requirements
- Firebase:
  - `google-services.json` in `android/app/` (provided externally; do not commit)
- Notifications:
  - Android 13+ runtime: `POST_NOTIFICATIONS`
  - Call channel importance `HIGH`
  - Full-screen notifications might require user enabling the app/channel setting on some devices
- Calls / FGS permissions:
  - `android.permission.MANAGE_OWN_CALLS`
  - `android.permission.USE_FULL_SCREEN_INTENT`
  - `android.permission.FOREGROUND_SERVICE`
  - `android.permission.FOREGROUND_SERVICE_PHONE_CALL`

## Key implementation files (source of truth)
- JS:
  - `MyApp/index.js`
  - `MyApp/src/calls/CallService.ts`
  - `MyApp/src/calls/nativeIncomingCall.ts`
  - `MyApp/src/calls/utils.ts` (defaults `ttlSec` to 30s)
- Android (Kotlin):
  - `MyApp/android/app/src/main/java/com/consultease/app/calls/IncomingCallForegroundService.kt`
  - `MyApp/android/app/src/main/java/com/consultease/app/calls/IncomingCallNotification.kt`
  - `MyApp/android/app/src/main/java/com/consultease/app/calls/IncomingCallActivity.kt`
  - `MyApp/android/app/src/main/java/com/consultease/app/calls/IncomingCallActionReceiver.kt`
  - `MyApp/android/app/src/main/AndroidManifest.xml`

## Acceptance criteria
- Incoming invite shows an incoming call experience quickly (<3s on good network).
- Incoming call is registered as a **call** in Android system UI (CallKeep/Telecom).
- **System default ringtone** plays while ringing.
- Notification is **persistent** for the full ringing duration (FGS + ongoing, not auto-cancel).
- Answer / Decline work from notification, lock screen full-screen UI, and CallKeep UI.
- Duplicate invites for the same `callId` do not duplicate UI or backend callbacks.

## Milestones (minimal)
1. Add Firebase + request permissions + verify token retrieval.
2. Receive call invite (foreground + background handler).
3. Display incoming call via CallKeep (Android).
4. Implement accept/decline state machine + backend callback stubs + retries.
5. Add Foreground Service call notification + full-screen incoming UI.

