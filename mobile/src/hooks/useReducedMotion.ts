import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * The OS "reduce motion" setting (MASTER §1.7): when it is on, presses drop
 * their scale, and skeletons, drawers and toasts don't animate.
 *
 * One shared subscription for the whole app (many pressables read it), read
 * once at first use and kept current through `reduceMotionChanged`.
 */
let reduced = false;
let started = false;
const listeners = new Set<() => void>();

function setReduced(value: boolean) {
  if (value === reduced) return;
  reduced = value;
  for (const listener of listeners) listener();
}

function start() {
  if (started) return;
  started = true;
  try {
    void AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => setReduced(Boolean(value)))
      .catch(() => undefined);
    AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value) => setReduced(Boolean(value)));
  } catch {
    // No accessibility module (e.g. a test environment): keep motion on.
  }
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return reduced;
}

/** True while the OS asks for reduced motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
