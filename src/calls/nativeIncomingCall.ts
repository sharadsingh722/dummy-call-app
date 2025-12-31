import { NativeModules, Platform } from 'react-native';
import type { CallInvite } from './types';

type NativePendingAction = {
  callId: string;
  action: 'accept' | 'decline' | 'missed';
  timestampMs: number;
};

type IncomingCallManagerNativeModule = {
  startRinging: (callId: string, callerName: string, ttlSec: number, hasVideo: boolean) => void;
  stopRinging: (reason: string) => void;
  getAndClearPendingActions: () => Promise<NativePendingAction[]>;
};

function nativeModule(): IncomingCallManagerNativeModule | null {
  if (Platform.OS !== 'android') return null;
  return (NativeModules as any).IncomingCallManager ?? null;
}

export function startNativeRinging(invite: CallInvite): void {
  const mod = nativeModule();
  if (!mod) return;
  const hasVideo = invite.type === 'videoCall';
  const ttlSecRaw = Number(invite.ttlSec);
  const ttlSec = Number.isFinite(ttlSecRaw) && ttlSecRaw >= 5 ? Math.floor(ttlSecRaw) : 30;
  mod.startRinging(invite.callId, invite.callerName, ttlSec, hasVideo);
}

export function stopNativeRinging(reason: string): void {
  const mod = nativeModule();
  if (!mod) return;
  mod.stopRinging(reason);
}

export async function drainNativePendingActions(): Promise<NativePendingAction[]> {
  const mod = nativeModule();
  if (!mod) return [];
  try {
    const actions = await mod.getAndClearPendingActions();
    if (!Array.isArray(actions)) return [];
    return actions;
  } catch {
    return [];
  }
}
