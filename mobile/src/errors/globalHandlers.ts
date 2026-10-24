/**
 * Hardening & Pilot (Phase 8) §F: the global JS error handler and unhandled
 * promise rejections. Installed once, as early as possible (the root layout module).
 *
 * - `ErrorUtils.setGlobalHandler`: the error is captured (`fatal` when the
 *   runtime says so), then the previous handler runs as before (LogBox in
 *   development, the native crash in release).
 * - Unhandled rejections: Hermes' rejection tracker. In development the
 *   rejection is also logged, since this replaces the dev-only LogBox tracker.
 */
import { captureError } from '@/errors/capture';

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

type ErrorUtilsLike = {
  getGlobalHandler: () => GlobalHandler | undefined;
  setGlobalHandler: (handler: GlobalHandler) => void;
};

type RejectionTrackerOptions = {
  allRejections: boolean;
  onUnhandled: (id: number, rejection: unknown) => void;
  onHandled: (id: number) => void;
};

type HermesLike = {
  enablePromiseRejectionTracker?: (options: RejectionTrackerOptions) => void;
};

let installed = false;

/** Installs both handlers once. Never throws. */
export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;
  const scope = globalThis as { ErrorUtils?: ErrorUtilsLike; HermesInternal?: HermesLike };

  try {
    const errorUtils = scope.ErrorUtils;
    if (errorUtils) {
      const previous = errorUtils.getGlobalHandler();
      errorUtils.setGlobalHandler((error, isFatal) => {
        captureError(error, { level: isFatal ? 'fatal' : 'error', extra: { source: 'global_handler' } });
        previous?.(error, isFatal);
      });
    }
  } catch {
    // No global handler in this runtime.
  }

  try {
    scope.HermesInternal?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (_id, rejection) => {
        captureError(rejection, { level: 'error', extra: { source: 'unhandled_rejection' } });
        if (__DEV__) console.warn('Unhandled promise rejection', rejection);
      },
      onHandled: () => undefined,
    });
  } catch {
    // Not Hermes: rejections are not tracked.
  }
}
