/**
 * Hardening & Pilot (Phase 8) §F: app error capture.
 *
 * `captureError` turns anything thrown into a redacted `ClientError` and
 * queues it. It never throws and never blocks:
 * - The same local fingerprint (message + top frame) within 60 s is counted once.
 * - Redaction (`@pos/core/errors/redact`) runs **before** the error is stored.
 * - The queue is the SQLite `error_queue` (≤ 200, oldest dropped first). Until
 *   the database is ready (or when it failed to migrate) errors wait in memory,
 *   with the same cap; `@/errors/errorQueue` moves them over or sends them directly.
 * - SQLite writes are synchronous (Drizzle's expo-sqlite driver), so a fatal
 *   error is stored before the previous global handler ends the app.
 *
 * Sources: the global JS handler and unhandled rejections (`@/errors/globalHandlers`),
 * the root error boundary, a print failure after all retries, a sale rejected by
 * `/sync/orders`, an unexpected 5xx from any service call, and a failed SQLite migration.
 * Native (Java/Kotlin) crashes are not captured.
 */
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { errorQueueRepository, ERROR_QUEUE_LIMIT } from '@/db/errorQueueRepository';
import { CLIENT_ERRORS_PATH } from '@/services/clientErrors';
import { setServerErrorReporter } from '@/services/api';
import { getInstallId } from '@/services/secureStorage';
import type { ClientError, ClientErrorContext, ErrorLevel } from '@/services/types';
import { useConnectivityStore } from '@/stores/connectivity';
import { useDiagnosticsStore } from '@/stores/diagnostics';
import { useSyncStore } from '@/stores/sync';
import { appVersion } from '@/utils/appVersion';
import { ulid } from '@/utils/ulid';
import { createErrorDeduper, localFingerprint } from '@pos/core/errors/fingerprint';
import { redactClientError } from '@pos/core/errors/redact';

export type CaptureOptions = {
  level?: ErrorLevel;
  /** Small, non-personal facts (string values): redacted and limited to 20 keys. */
  extra?: Record<string, string>;
  /** Test hook: the clock. */
  now?: number;
};

const deduper = createErrorDeduper();
/** Errors held while the database isn't ready (oldest first). */
let memory: ClientError[] = [];
let installId: string | null = null;
let currentScreen: string | null = null;

/** The route the user is on (set by the root layout), sent as `context.screen`. */
export function setCurrentScreen(pathname: string | null): void {
  currentScreen = pathname;
}

/** A message and stack from anything thrown. */
export function describeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    const name = error.name && error.name !== 'Error' ? `${error.name}: ` : '';
    return { message: `${name}${error.message || 'Unknown error'}`, stack: typeof error.stack === 'string' ? error.stack : null };
  }
  if (typeof error === 'string') return { message: error || 'Unknown error', stack: null };
  try {
    return { message: JSON.stringify(error) ?? 'Unknown error', stack: null };
  } catch {
    return { message: 'Unknown error', stack: null };
  }
}

function deviceModel(): string | null {
  try {
    return Device.modelName ?? null;
  } catch {
    return null;
  }
}

function context(extra: Record<string, string> | undefined): ClientErrorContext {
  return {
    screen: currentScreen,
    app_version: appVersion(),
    os: Platform.OS,
    os_version: String(Platform.Version ?? ''),
    device_model: deviceModel(),
    install_id: installId,
    online: useConnectivityStore.getState().serverReachable,
    extra: extra ?? null,
  };
}

/** Recounts the waiting errors (`databaseReady`: the caller knows the database is usable). */
async function refreshPendingCount(databaseReady: boolean = useSyncStore.getState().database === 'ready'): Promise<void> {
  let stored = 0;
  try {
    if (databaseReady) stored = await errorQueueRepository.count();
  } catch {
    stored = 0;
  }
  useDiagnosticsStore.getState().setErrorsPending(stored + memory.length);
}

function holdInMemory(error: ClientError): void {
  memory.push(error);
  if (memory.length > ERROR_QUEUE_LIMIT) memory = memory.slice(memory.length - ERROR_QUEUE_LIMIT);
}

function store(error: ClientError): void {
  if (useSyncStore.getState().database === 'ready') {
    // Synchronous under the hood: the row is written before this returns.
    errorQueueRepository.enqueue([error], error.occurred_at).catch(() => holdInMemory(error));
  } else {
    holdInMemory(error);
  }
  void refreshPendingCount();
}

/** Records an error for the error log. Never throws. */
export function captureError(error: unknown, options: CaptureOptions = {}): void {
  try {
    const now = options.now ?? Date.now();
    const { message, stack } = describeError(error);
    if (!deduper.shouldRecord(localFingerprint(message, stack), now)) return;
    const entry = redactClientError({
      ulid: ulid(),
      occurred_at: new Date(now).toISOString(),
      level: options.level ?? 'error',
      message,
      stack,
      context: context(options.extra),
    });
    store(entry);
  } catch {
    // Capture must never become the crash.
  }
}

/** Takes the errors held in memory (the queue then owns them). */
export function takeMemoryErrors(): ClientError[] {
  const taken = memory;
  memory = [];
  return taken;
}

/** Puts errors back in memory, ahead of newer ones (a failed send). */
export function returnMemoryErrors(errors: readonly ClientError[]): void {
  memory = [...errors, ...memory].slice(-ERROR_QUEUE_LIMIT);
}

export function memoryErrorCount(): number {
  return memory.length;
}

export { refreshPendingCount as refreshErrorsPending };

let initialised = false;

/**
 * Startup (once): reads the install id for `context.install_id`, and registers
 * the API client's 5xx reporter (`level: error`). `POST /client-errors` never
 * reports its own failures.
 */
export function initErrorCapture(): void {
  if (initialised) return;
  initialised = true;
  void getInstallId().then((id) => {
    installId = id;
  });
  setServerErrorReporter((report) => {
    if (report.path === CLIENT_ERRORS_PATH) return;
    captureError(new Error(`HTTP ${report.status} on ${report.method} ${report.path}: ${report.message}`), {
      level: 'error',
      extra: { source: 'api', method: report.method, path: report.path, status: String(report.status) },
    });
  });
}

/** The install id was just created (first registration): use it from now on. */
export function setCaptureInstallId(id: string | null): void {
  installId = id;
}

/** Test helper: forget everything held in memory and the de-duplication window. */
export function resetErrorCaptureForTests(): void {
  memory = [];
  deduper.clear();
  installId = null;
  currentScreen = null;
  initialised = false;
}
