import { PermissionsAndroid, Platform, type Permission } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import RNCallKeep from 'react-native-callkeep';
import { parseCallEnded, parseCallInvite } from './utils';
import type { CallAction, CallInvite } from './types';
import { sendCallAction, sendCallEnd, sendReceiverRingingAck } from './backend';
import { setCallUiState } from './callUiStore';
import { dlog, dwarn, redactUrl } from './debug';
import { drainNativePendingActions, startNativeRinging, stopNativeRinging } from './nativeIncomingCall';

 
const PENDING_ACTIONS_KEY = 'pendingCallActions:v1';
const INVITE_KEY_PREFIX = 'callInvite:v1:';
const ACTION_DONE_KEY_PREFIX = 'callActionDone:v1:';

const calls = new Map<string, InternalCallState>();
let bootstrapDone = false;
let flushInFlight = false;
let callKeepBound = false;

function log(event: string, extra: Record<string, unknown> = {}): void {
  console.log(`[calls] ${event}`, extra);
}

async function loadPendingActions(): Promise<PendingAction[]> {
  const raw = await AsyncStorage.getItem(PENDING_ACTIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PendingAction[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

async function savePendingActions(actions: PendingAction[]): Promise<void> {
  await AsyncStorage.setItem(PENDING_ACTIONS_KEY, JSON.stringify(actions));
}

async function persistInvite(invite: CallInvite): Promise<void> {
  dlog('[calls][storage] persistInvite', { callId: invite.callId, ttlSec: invite.ttlSec });
  await AsyncStorage.setItem(`${INVITE_KEY_PREFIX}${invite.callId}`, JSON.stringify(invite));
}

async function loadInvite(callId: string): Promise<CallInvite | null> {
  dlog('[calls][storage] loadInvite', { callId });
  const raw = await AsyncStorage.getItem(`${INVITE_KEY_PREFIX}${callId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CallInvite;
  } catch {
    return null;
  }
}

async function removeInvite(callId: string): Promise<void> {
  dlog('[calls][storage] removeInvite', { callId });
  await AsyncStorage.removeItem(`${INVITE_KEY_PREFIX}${callId}`);
}

async function enqueuePendingAction(invite: CallInvite, action: CallAction, error?: unknown): Promise<void> {
  if (await isActionDone(invite.callId, action)) return;
  const actions = await loadPendingActions();
  const key = `${invite.callId}:${action}`;
  const exists = actions.some(a => `${a.callId}:${a.action}` === key);
  if (exists) return;

  actions.push({
    callId: invite.callId,
    action,
    invite,
    attempts: 0,
    nextAttemptAtMs: Date.now(),
    lastError: error instanceof Error ? error.message : String(error ?? ''),
  });

  await savePendingActions(actions);
}

function actionDoneKey(callId: string, action: CallAction): string {
  return `${ACTION_DONE_KEY_PREFIX}${callId}:${action}`;
}

async function isActionDone(callId: string, action: CallAction): Promise<boolean> {
  return (await AsyncStorage.getItem(actionDoneKey(callId, action))) === '1';
}

async function markActionDone(callId: string, action: CallAction): Promise<void> {
  await AsyncStorage.setItem(actionDoneKey(callId, action), '1');
}

async function performBackendAction(invite: CallInvite, action: CallAction): Promise<void> {
  if (invite.actionEndpoint) {
    await sendCallAction({ invite, action });
    return;
  }

  if (action === 'decline') {
    await sendCallEnd({ invite, status: 'declined' });
    return;
  }

  if (action === 'missed') {
    await sendCallEnd({ invite, status: 'missed' });
    return;
  }

  if (action === 'accept') {
    return;
  }
}

async function trySendActionWithRetry(invite: CallInvite, action: CallAction): Promise<void> {
  try {
    await performBackendAction(invite, action);
    log('backend_ack_success', { callId: invite.callId, action });
    await markActionDone(invite.callId, action);
  } catch (error) {
    log('backend_ack_failed', { callId: invite.callId, action, error: String(error) });
    await enqueuePendingAction(invite, action, error);
    throw error;
  }
}

export async function flushPendingActions(): Promise<void> {
  if (flushInFlight) return;
  flushInFlight = true;
  try {
    const now = Date.now();
    const actions = await loadPendingActions();
    dlog('[calls][retry] flush start', { count: actions.length });
    const remaining: PendingAction[] = [];

    for (const pending of actions) {
      if (pending.nextAttemptAtMs > now) {
        remaining.push(pending);
        continue;
      }

      try {
        dlog('[calls][retry] attempt', {
          callId: pending.callId,
          action: pending.action,
          attempts: pending.attempts,
          nextAttemptAtMs: pending.nextAttemptAtMs,
          endpoint: pending.invite.actionEndpoint ? redactUrl(pending.invite.actionEndpoint) : null,
        });
        await performBackendAction(pending.invite, pending.action);
        log('backend_ack_success', { callId: pending.callId, action: pending.action, recovered: true });
        await markActionDone(pending.callId, pending.action);
      } catch (error) {
        dwarn('[calls][retry] attempt failed', {
          callId: pending.callId,
          action: pending.action,
          attempts: pending.attempts,
          error,
        });
        const attempts = pending.attempts + 1;
        const delayMs = Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5));
        remaining.push({
          ...pending,
          attempts,
          lastError: error instanceof Error ? error.message : String(error),
          nextAttemptAtMs: Date.now() + delayMs,
        });
      }
    }

    await savePendingActions(remaining);
    dlog('[calls][retry] flush done', { remaining: remaining.length });
  } finally {
    flushInFlight = false;
  }
}

async function cleanupLocalCall(callId: string, reason: string): Promise<void> {
  const existing = calls.get(callId);
  dlog('[calls] cleanupLocalCall', { callId, reason, status: existing?.status });
  try {
    clearCallTimeout(callId);
  } catch {}
  stopNativeRinging(`cleanup:${reason}`);
  try {
    await removeInvite(callId);
  } catch {}
  calls.delete(callId);
  setCallUiState({ status: 'ended', callId, callerName: existing?.invite.callerName });
}

function clearCallTimeout(callId: string): void {
  const state = calls.get(callId);
  if (!state?.timeoutHandle) return;
  dlog('[calls][timer] clear timeout', { callId });
  clearTimeout(state.timeoutHandle);
  state.timeoutHandle = null;
}

function scheduleMissedTimeout(invite: CallInvite): void {
  const state = calls.get(invite.callId);
  if (!state) return;
  if (!invite.ttlSec) return;
  clearCallTimeout(invite.callId);
  dlog('[calls][timer] schedule missed timeout', { callId: invite.callId, ttlSec: invite.ttlSec });

  state.timeoutHandle = setTimeout(() => {
    markMissed(invite.callId).catch(() => {});
  }, invite.ttlSec * 1000);
}

async function markMissed(callId: string): Promise<void> {
  dlog('[calls] markMissed begin', { callId });
  const state = await getOrRehydrateCallState(callId);
  if (!state) return;
  if (state.status !== 'ringing') return;

  state.status = 'missed';
  setCallUiState({ status: 'missed', callId, callerName: state.invite.callerName });
  clearCallTimeout(callId);
  stopNativeRinging('missed');

  await handleActionOnce(state.invite, 'missed');
  state.status = 'ended';
  setCallUiState({ status: 'ended', callId, callerName: state.invite.callerName });
  await removeInvite(callId);
}

async function handleActionOnce(invite: CallInvite, action: CallAction): Promise<void> {
  const state = calls.get(invite.callId);
  if (!state) return;
  if (state.processedActions.has(action)) return;
  if (await isActionDone(invite.callId, action)) {
    state.processedActions.add(action);
    return;
  }
  dlog('[calls] handleActionOnce', { callId: invite.callId, action });
  state.processedActions.add(action);
  await trySendActionWithRetry(invite, action).catch(() => {});
  flushPendingActions().catch(() => {});
}

function hasRingingOrActiveCall(): boolean {
  for (const state of calls.values()) {
    if (state.status === 'ringing' || state.status === 'accepted') return true;
  }
  return false;
}

export async function handleIncomingInvite(invite: CallInvite, source: string): Promise<void> {
  dlog('[calls] handleIncomingInvite', { callId: invite.callId, source, ttlSec: invite.ttlSec });
  if (calls.has(invite.callId)) {
    log('call_invite_duplicate_ignored', { callId: invite.callId, source });
    return;
  }

  if (hasRingingOrActiveCall()) {
    log('call_invite_ignored_busy', { callId: invite.callId, source });
    return;
  }

  calls.set(invite.callId, {
    invite,
    status: 'ringing',
    timeoutHandle: null,
    processedActions: new Set<CallAction>(),
  });
  await persistInvite(invite);

  log('call_invite_received', { callId: invite.callId, source });
  setCallUiState({ status: 'ringing', callId: invite.callId, callerName: invite.callerName });
  scheduleMissedTimeout(invite);

  await showIncomingCallUi(invite);
  log('call_ui_shown', { callId: invite.callId, via: 'callkeep+fgs' });

  if (invite.receiverId) {
    sendReceiverRingingAck({ callId: invite.callId, receiverId: invite.receiverId })
      .then(() => dlog('[calls] receiver-ringing-ack success', { callId: invite.callId }))
      .catch(error => dwarn('[calls] receiver-ringing-ack failed (non-blocking)', { callId: invite.callId, error }));
  } else {
    dwarn('[calls] receiver-ringing-ack skipped (missing receiverId)', { callId: invite.callId });
  }
}

export async function acceptCall(callId: string, reason: string): Promise<void> {
  dlog('[calls] acceptCall', { callId, reason });
  const state = await getOrRehydrateCallState(callId);
  if (!state) return;
  if (state.status !== 'ringing') return;

  state.status = 'accepted';
  clearCallTimeout(callId);
  stopNativeRinging('accepted');
  setCallUiState({ status: 'accepted', callId, callerName: state.invite.callerName });

  await handleActionOnce(state.invite, 'accept');
  log('call_accepted', { callId, reason });
}

export async function declineCall(callId: string, reason: string): Promise<void> {
  dlog('[calls] declineCall', { callId, reason });
  const state = await getOrRehydrateCallState(callId);
  if (!state) return;
  if (state.status !== 'ringing') return;

  state.status = 'declined';
  clearCallTimeout(callId);
  stopNativeRinging('declined');
  setCallUiState({ status: 'declined', callId, callerName: state.invite.callerName });

  await handleActionOnce(state.invite, 'decline');
  state.status = 'ended';
  setCallUiState({ status: 'ended', callId, callerName: state.invite.callerName });
  log('call_declined', { callId, reason });
  await removeInvite(callId);
}

export async function endCall(callId: string, reason: string): Promise<void> {
  dlog('[calls] endCall', { callId, reason });
  const state = await getOrRehydrateCallState(callId);
  if (!state) return;
  clearCallTimeout(callId);
  stopNativeRinging(`end:${reason}`);

  if (state.status === 'ringing') {
    await declineCall(callId, reason);
    return;
  }

  state.status = 'ended';
  setCallUiState({ status: 'ended', callId, callerName: state.invite.callerName });
  log('call_ended', { callId, reason });
  await removeInvite(callId);
}

async function getOrRehydrateCallState(callId: string): Promise<InternalCallState | null> {
  const existing = calls.get(callId);
  if (existing) return existing;

  dlog('[calls] rehydrate state from storage', { callId });
  const invite = await loadInvite(callId);
  if (!invite) return null;

  const state: InternalCallState = {
    invite,
    status: 'ringing',
    timeoutHandle: null,
    processedActions: new Set<CallAction>(),
  };
  calls.set(callId, state);
  return state;
}

async function showIncomingCallUi(invite: CallInvite): Promise<void> {
  if (Platform.OS !== 'android') return;
  await bootstrapCallKeep().catch(() => {});

  // Create the telecom call (CallKeep) and the persistent call-style foreground notification.
  try {
    const handle = invite.callerId || invite.receiverId || invite.callId;
    RNCallKeep.displayIncomingCall(
      invite.callId,
      handle,
      invite.callerName,
      'number',
      invite.type === 'videoCall',
    );
  } catch (error) {
    dwarn('[callkeep] displayIncomingCall failed (non-blocking)', { callId: invite.callId, error });
  }

  try {
    startNativeRinging(invite);
  } catch (error) {
    dwarn('[native] startRinging failed (non-blocking)', { callId: invite.callId, error });
  }
}

export async function handleRemoteMessage(
  remoteMessage: FirebaseMessagingTypes.RemoteMessage,
  source: string,
): Promise<void> {
  dlog('[fcm] remoteMessage received', {
    source,
    messageId: remoteMessage.messageId,
    from: remoteMessage.from,
    sentTime: remoteMessage.sentTime,
    ttl: remoteMessage.ttl,
    collapseKey: remoteMessage.collapseKey,
    data: remoteMessage.data,
    notification: remoteMessage.notification,
  });
  const ended = parseCallEnded(remoteMessage.data);
  if (ended) {
    dlog('[fcm] CALL_ENDED received', ended);
    const statusLower = (ended.status ?? '').toLowerCase();

    if (ended.dismissNotification === false) {
      dwarn('[fcm] CALL_ENDED received but dismissNotification=false; keeping notification', ended);
      return;
    }

    await cleanupLocalCall(
      ended.callId,
      statusLower ? `CALL_ENDED:${statusLower}` : 'CALL_ENDED',
    );
    return;
  }

  const invite = parseCallInvite(remoteMessage.data);
  if (!invite) {
    dwarn('[fcm] remoteMessage ignored (not a call invite / call ended)', { source, data: remoteMessage.data });
    return;
  }
  await handleIncomingInvite(invite, source);
}

export async function requestAndroidPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const permissions: Permission[] = [];
  if (Platform.Version >= 33) {
    permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS as Permission);
  }

  if (permissions.length > 0) {
    dlog('[android] requesting permissions', { permissions, platformVersion: Platform.Version });
    const results = await PermissionsAndroid.requestMultiple(permissions);
    log('android_permissions', results);
  } else {
    dlog('[android] no runtime notification permission needed', { platformVersion: Platform.Version });
  }
}

export async function bootstrapCallService(): Promise<void> {
  if (bootstrapDone) return;
  bootstrapDone = true;

  dlog('[calls] bootstrap start', { platform: Platform.OS, platformVersion: Platform.Version });
  try {
    await requestAndroidPermissions();
  } catch {}

  await bootstrapCallKeep().catch(() => {});
  await applyNativePendingActions().catch(() => {});
  flushPendingActions().catch(() => {});

  dlog('[calls] bootstrap done', { API: 'actionEndpoint from FCM or persisted queue' });
}

async function bootstrapCallKeep(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (callKeepBound) return;

  try {
    await RNCallKeep.setup({
      ios: { appName: 'MyApp' },
      android: {
        alertTitle: 'Phone Accounts',
        alertDescription: 'This app needs permission to register incoming calls.',
        cancelButton: 'Cancel',
        okButton: 'OK',
        selfManaged: true,
      },
    });

    RNCallKeep.setAvailable(true);
    RNCallKeep.registerAndroidEvents();

    RNCallKeep.addEventListener('answerCall', ({ callUUID }: { callUUID: string }) => {
      acceptCall(callUUID, 'callkeep_answer').catch(() => {});
    });

    RNCallKeep.addEventListener('endCall', ({ callUUID }: { callUUID: string }) => {
      endCall(callUUID, 'callkeep_end').catch(() => {});
    });

    try {
      const initialEvents = (await RNCallKeep.getInitialEvents()) as Array<{ name?: string; data?: any }>;
      for (const ev of initialEvents ?? []) {
        const name = ev?.name ?? '';
        const callUUID = ev?.data?.callUUID ?? '';
        if (!callUUID) continue;

        if (name === 'RNCallKeepPerformAnswerCallAction') {
          acceptCall(callUUID, 'callkeep_initial').catch(() => {});
        } else if (name === 'RNCallKeepPerformEndCallAction') {
          endCall(callUUID, 'callkeep_initial').catch(() => {});
        }
      }
      RNCallKeep.clearInitialEvents();
    } catch {}

    callKeepBound = true;
  } catch (error) {
    dwarn('[callkeep] bootstrap failed (non-blocking)', { error });
    callKeepBound = false;
  }
}

async function applyNativePendingActions(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const actions = await drainNativePendingActions();
  if (actions.length === 0) return;

  dlog('[native] applying pending actions', { count: actions.length });
  for (const a of actions) {
    if (!a.callId) continue;
    if (a.action === 'accept') {
      await acceptCall(a.callId, 'native_pending').catch(() => {});
    } else if (a.action === 'decline') {
      await declineCall(a.callId, 'native_pending').catch(() => {});
    } else if (a.action === 'missed') {
      await markMissed(a.callId).catch(() => {});
    }
  }
}
