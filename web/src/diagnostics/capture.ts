/**
 * Global error capture for the web terminal (Hardening & Pilot §I), installed
 * once before the app renders:
 * - `window` `error` (uncaught exceptions) and `unhandledrejection`;
 * - an unexpected 5xx from any service call (through the API client's reporter);
 * - the queue is flushed every 60 s and on the browser's `online` event.
 * The root React error boundary and failed print jobs report through
 * `captureError` directly (`RootErrorBoundary.tsx`, `printJobLog.ts`).
 */
import { captureError, describeThrown, flushErrorQueue } from '@/diagnostics/errorQueue';
import { isApiError, setServerErrorReporter } from '@/services/api';
import { CLIENT_ERRORS_PATH } from '@/services/clientErrors';

export const ERROR_FLUSH_INTERVAL_MS = 60_000;

/** Browser noise that is not an app error. */
const IGNORED_MESSAGES = [/^ResizeObserver loop/i];

let installed = false;

export function installErrorCapture(): void {
  if (installed) return;
  installed = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    const thrown = event.error !== undefined && event.error !== null ? describeThrown(event.error) : null;
    const message = thrown?.message ?? event.message ?? 'Script error';
    if (IGNORED_MESSAGES.some((pattern) => pattern.test(message))) return;
    captureError({ level: 'error', message, stack: thrown?.stack ?? null, extra: { handler: 'window.onerror' } });
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    // A failed API call is an answer the page already shows; its 5xx is reported below.
    if (isApiError(event.reason)) return;
    const { message, stack } = describeThrown(event.reason);
    captureError({ level: 'error', message, stack, extra: { handler: 'unhandledrejection' } });
  });

  setServerErrorReporter((report) => {
    // Never report the error log's own endpoint (no loop).
    if (report.path === CLIENT_ERRORS_PATH) return;
    captureError({
      level: 'error',
      message: `HTTP ${report.status} on ${report.method} ${report.path}: ${report.message}`,
      extra: { status: String(report.status), method: report.method, path: report.path },
    });
  });

  window.addEventListener('online', () => void flushErrorQueue());
  window.setInterval(() => void flushErrorQueue(), ERROR_FLUSH_INTERVAL_MS);
  void flushErrorQueue();
}
