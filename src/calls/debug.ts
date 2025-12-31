declare const __DEV__: boolean;

export const CALL_DEBUG_ENABLED = __DEV__;

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_key, v) => {
        if (typeof v === 'bigint') return v.toString();
        if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
        return v;
      },
      2,
    );
  } catch {
    try {
      return String(value);
    } catch {
      return '[unstringifiable]';
    }
  }
}

export function dlog(message: string, extra?: unknown): void {
  if (!CALL_DEBUG_ENABLED) return;
  if (typeof extra === 'undefined') console.log(message);
  else console.log(message, safeStringify(extra));
}

export function dwarn(message: string, extra?: unknown): void {
  if (!CALL_DEBUG_ENABLED) return;
  if (typeof extra === 'undefined') console.warn(message);
  else console.warn(message, safeStringify(extra));
}

export function derror(message: string, extra?: unknown): void {
  if (!CALL_DEBUG_ENABLED) return;
  if (typeof extra === 'undefined') console.error(message);
  else console.error(message, safeStringify(extra));
}

export function redactUrl(url: string): string {
  const trimmed = (url ?? '').trim();
  if (!trimmed) return trimmed;
  const idx = trimmed.indexOf('?');
  if (idx === -1) return trimmed;
  return `${trimmed.slice(0, idx)}?REDACTED`;
}
