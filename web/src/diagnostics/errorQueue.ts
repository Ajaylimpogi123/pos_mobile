/**
 * The web terminal's error queue (Hardening & Pilot §I), in `localStorage` key
 * `pos.errorQueue`:
 * - every entry is redacted and de-duplicated (60 s, by the local fingerprint)
 *   with the shared rules from `@pos/core/errors`, so it matches the tablet;
 * - at most 200 entries, the oldest dropped first;
 * - flushed to `POST /client-errors` in batches of 20 (every 60 s, on the
 *   browser's `online` event and after login: see `capture.ts`, `useAuth.ts`);
 * - a 429, a 5xx or a network error keeps the entries for the next flush;
 * - a `localStorage` failure loses the entries silently and never breaks the page.
 */
import { APP_VERSION } from '@/constants/appVersion';
import { isApiError } from '@/services/api';
import { sendClientErrors } from '@/services/clientErrors';
import type { ClientError, ClientErrorContext, ErrorLevel } from '@/services/types';
import { getInstallId } from '@/stores/terminal';
import { browserVersion } from '@/utils/terminalName';
import { ulid } from '@/utils/ulid';
import { createErrorDeduper, localFingerprint } from '@pos/core/errors/fingerprint';
import { redactClientError } from '@pos/core/errors/redact';

const QUEUE_KEY = 'pos.errorQueue';
export const ERROR_QUEUE_MAX = 200;
export const ERROR_BATCH_SIZE = 20;

const deduper = createErrorDeduper();
const listeners = new Set<() => void>();
/** In-memory copy, so the pending count can be read without parsing storage on every render. */
let cache: ClientError[] | null = null;

function isClientError(value: unknown): value is ClientError {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ClientError>;
  return typeof entry.ulid === 'string' && typeof entry.message === 'string' && typeof entry.occurred_at === 'string';
}

function readQueue(): ClientError[] {
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter(isClientError) : [];
  } catch {
    cache = cache ?? [];
  }
  return cache;
}

function writeQueue(entries: ClientError[]): void {
  cache = entries;
  try {
    if (entries.length === 0) window.localStorage.removeItem(QUEUE_KEY);
    else window.localStorage.setItem(QUEUE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or unavailable: the entries are lost silently (§I).
  }
  for (const listener of listeners) listener();
}

/** The number of error reports waiting to be sent (the heartbeat's `errors_pending`). */
export function pendingErrorCount(): number {
  return (cache ?? readQueue()).length;
}

/** For `useSyncExternalStore`: called whenever the queue changes. */
export function subscribeErrorQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** §I context: `os: "web"`, the browser as `os_version`, no device model, the terminal's install id. */
function errorContext(extra: Record<string, string> | null): ClientErrorContext {
  return {
    screen: window.location.pathname,
    app_version: APP_VERSION,
    os: 'web',
    os_version: browserVersion(),
    device_model: null,
    install_id: getInstallId(),
    online: navigator.onLine,
    extra,
  };
}

export type CapturedError = {
  level: ErrorLevel;
  message: string;
  stack?: string | null;
  /** Small, non-personal details (string values). Redacted again before queueing. */
  extra?: Record<string, string> | null;
};

/** Queues one error (redacted, de-duplicated). Never throws. */
export function captureError(error: CapturedError): void {
  try {
    const message = error.message.trim() || 'Unknown error';
    const stack = error.stack ?? null;
    if (!deduper.shouldRecord(localFingerprint(message, stack), Date.now())) return;
    const entry = redactClientError({
      ulid: ulid(),
      occurred_at: new Date().toISOString(),
      level: error.level,
      message,
      stack,
      context: errorContext(error.extra ?? null),
    });
    const queue = [...readQueue(), entry];
    writeQueue(queue.slice(Math.max(0, queue.length - ERROR_QUEUE_MAX)));
  } catch {
    // Capturing an error must never cause another one.
  }
}

/** A thrown value's message and stack. */
export function describeThrown(value: unknown): { message: string; stack: string | null } {
  if (value instanceof Error) return { message: `${value.name}: ${value.message}`, stack: value.stack ?? null };
  if (typeof value === 'string') return { message: value, stack: null };
  try {
    return { message: JSON.stringify(value) ?? String(value), stack: null };
  } catch {
    return { message: String(value), stack: null };
  }
}

let flushing: Promise<void> | null = null;

/** Sends the queue in batches of 20 until it is empty or a batch fails. One flush at a time; never throws. */
export function flushErrorQueue(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      for (;;) {
        const batch = readQueue().slice(0, ERROR_BATCH_SIZE);
        if (batch.length === 0) return;
        try {
          await sendClientErrors({ errors: batch });
        } catch (error) {
          // A malformed batch (422) would never be accepted: drop it so the rest can go.
          // 429, 5xx, 401, a network error or a timeout keep everything for the next flush.
          if (!(isApiError(error) && error.status === 422)) return;
        }
        const sent = new Set(batch.map((entry) => entry.ulid));
        writeQueue(readQueue().filter((entry) => !sent.has(entry.ulid)));
      }
    } catch {
      // Never surfaces.
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}
