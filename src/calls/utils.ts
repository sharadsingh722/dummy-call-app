import type { CallEnded, CallInvite } from './types';

function getString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function parseCallInvite(data: Record<string, unknown> | undefined | null): CallInvite | null {
  if (!data) return null;
  const rawType = getString(data, 'type').trim();
  const typeLower = rawType.toLowerCase();

  const isCallInvite =
    typeLower === 'call_invite' ||
    typeLower === 'voicecall' ||
    typeLower === 'videocall' ||
    typeLower === 'voice_call' ||
    typeLower === 'video_call' ||
    typeLower === 'call' ||
    typeLower === 'call_ringing';

  if (!isCallInvite) return null;

  const callId = getString(data, 'callId').trim();
  const callerName = getString(data, 'callerName').trim();
  if (!callId || !callerName) return null;

  const timestampMs = Number(getString(data, 'timestampMs') || getString(data, 'timestamp') || Date.now());
  const ttlSecRaw = getString(data, 'ttlSec').trim();
  const ttlSecParsed = ttlSecRaw ? Number(ttlSecRaw) : NaN;
  const ttlSecDefaulted = Number.isFinite(ttlSecParsed) && ttlSecParsed >= 5 ? ttlSecParsed : 30;
  const ttlSec = Math.min(Math.max(Math.floor(ttlSecDefaulted), 5), 120);

  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return null;
  if (!Number.isFinite(ttlSec) || ttlSec < 5) return null;

  const actionEndpoint = getString(data, 'actionEndpoint').trim() || undefined;
  const channelName = getString(data, 'channelName').trim() || undefined;
  const roomId = getString(data, 'roomId').trim() || undefined;
  const token = getString(data, 'token').trim() || undefined;
  const callerId = getString(data, 'callerId').trim() || undefined;
  const receiverId = getString(data, 'receiverId').trim() || undefined;
  const calleridDocID = getString(data, 'calleridDocID').trim() || undefined;
  const receiverDocID = getString(data, 'receiverDocID').trim() || undefined;
  const category = getString(data, 'category').trim() || undefined;
  const categoryName = getString(data, 'categoryName').trim() || undefined;
  const ProfilePic = getString(data, 'ProfilePic').trim() || undefined;

  const type: CallInvite['type'] = typeLower.includes('video') ? 'videoCall' : 'voiceCall';

  return {
    type,
    callId,
    callerName,
    timestampMs,
    ttlSec,
    actionEndpoint,
    channelName,
    roomId,
    token,
    callerId,
    receiverId,
    calleridDocID,
    receiverDocID,
    category,
    categoryName,
    ProfilePic,
  };
}

export function parseCallEnded(data: Record<string, unknown> | undefined | null): CallEnded | null {
  if (!data) return null;
  const rawType = getString(data, 'type').trim();
  if (rawType.toLowerCase() !== 'call_ended') return null;

  const callId = getString(data, 'callId').trim();
  if (!callId) return null;

  const status = getString(data, 'status').trim() || undefined;
  const dismissNotificationRaw = getString(data, 'dismissNotification').trim().toLowerCase();
  const dismissNotification =
    dismissNotificationRaw === 'true' ? true : dismissNotificationRaw === 'false' ? false : undefined;

  return { type: 'CALL_ENDED', callId, status, dismissNotification };
}
