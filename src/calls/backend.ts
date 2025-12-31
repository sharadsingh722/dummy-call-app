import type { CallAction, CallInvite } from './types';
import { API_BASE_URL } from '../config/api';
import { derror, dlog, redactUrl } from './debug';

type SendCallActionParams = {
  invite: CallInvite;
  action: CallAction;
};

function resolveEndpoint(actionEndpoint: string | undefined): string | null {
  const endpoint = (actionEndpoint ?? '').trim();
  if (!endpoint) return null;
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  if (endpoint.startsWith('/')) return `${API_BASE_URL}${endpoint}`;
  return `${API_BASE_URL}/${endpoint}`;
}

export async function sendCallAction({ invite, action }: SendCallActionParams): Promise<void> {
  const endpoint = resolveEndpoint(invite.actionEndpoint);
  if (!endpoint) {
    console.log('[calls] backend callback skipped (no actionEndpoint)', {
      callId: invite.callId,
      action,
      API_BASE_URL,
    });
    return;
  }

  const startedAtMs = Date.now();
  dlog('[calls][backend] sending', {
    callId: invite.callId,
    action,
    endpoint: redactUrl(endpoint),
  });

  const body = JSON.stringify({
    callId: invite.callId,
    action,
    timestampMs: Date.now(),
  });

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  } catch (error) {
    derror('[calls][backend] network error', {
      callId: invite.callId,
      action,
      endpoint: redactUrl(endpoint),
      error,
      durationMs: Date.now() - startedAtMs,
    });
    throw error;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    derror('[calls][backend] non-2xx', {
      callId: invite.callId,
      action,
      endpoint: redactUrl(endpoint),
      status: response.status,
      body: text,
      durationMs: Date.now() - startedAtMs,
    });
    throw new Error(`backend callback failed: ${response.status} ${text}`.trim());
  }

  dlog('[calls][backend] success', {
    callId: invite.callId,
    action,
    endpoint: redactUrl(endpoint),
    status: response.status,
    durationMs: Date.now() - startedAtMs,
  });
}

type ReceiverRingingAckParams = {
  callId: string;
  receiverId: string;
};

export async function sendReceiverRingingAck({ callId, receiverId }: ReceiverRingingAckParams): Promise<void> {
  const startedAtMs = Date.now();
  const endpoint = `${API_BASE_URL}/api/call/receiver-ringing-ack`;
  dlog('[calls][backend] receiver-ringing-ack', { callId, receiverId, endpoint });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callId, receiverId }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    derror('[calls][backend] receiver-ringing-ack failed', {
      callId,
      receiverId,
      status: response.status,
      body: text,
      durationMs: Date.now() - startedAtMs,
    });
    throw new Error(`receiver-ringing-ack failed: ${response.status} ${text}`.trim());
  }
}

export type CallEndStatus = 'declined' | 'missed' | 'timeout' | 'completed';

type CallEndParams = {
  invite: CallInvite;
  status: CallEndStatus;
};

export async function sendCallEnd({ invite, status }: CallEndParams): Promise<void> {
  const startedAtMs = Date.now();
  const endpoint = `${API_BASE_URL}/api/call/Callend`;
  dlog('[calls][backend] Callend', { callId: invite.callId, status, endpoint: redactUrl(endpoint) });

  const body = {
    callId: Number.parseInt(invite.callId, 10),
    status,
    callStatus: status,
    startTime: invite.timestampMs ? new Date(invite.timestampMs).toISOString() : null,
    endTime: new Date().toISOString(),
    duration: 0,
    type: invite.type || 'voiceCall',
    calleridDocID: invite.calleridDocID ?? invite.callerId ?? null,
    endedById: invite.receiverId ?? invite.callerId ?? null,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    derror('[calls][backend] Callend failed', {
      callId: invite.callId,
      status,
      httpStatus: response.status,
      body: text,
      durationMs: Date.now() - startedAtMs,
    });
    throw new Error(`Callend failed: ${response.status} ${text}`.trim());
  }
}
