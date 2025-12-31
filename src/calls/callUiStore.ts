export type CallUiStatus = 'idle' | 'ringing' | 'accepted' | 'declined' | 'missed' | 'ended';

export type CallUiState = {
  status: CallUiStatus;
  callId?: string;
  callerName?: string;
  lastEventAtMs: number;
};

let state: CallUiState = { status: 'idle', lastEventAtMs: Date.now() };
const listeners = new Set<() => void>();

export function getCallUiState(): CallUiState {
  return state;
}

export function subscribeCallUiState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setCallUiState(next: Omit<CallUiState, 'lastEventAtMs'>): void {
  state = { ...next, lastEventAtMs: Date.now() };
  listeners.forEach(listener => listener());
}

