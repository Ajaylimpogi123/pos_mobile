/**
 * Hardening & Pilot §B/§F: message normalisation, the local fingerprint and the
 * 60 s de-duplication. The server computes its own fingerprint (sha1, with the
 * source and level); this local one only decides what is "the same error" on
 * the device so a crash loop does not flood the queue.
 */

/** §F: the same fingerprint within this window is counted once locally. */
export const DEDUPE_WINDOW_MS = 60_000;

const ULID_RE = /\b[0-9A-HJKMNP-TV-Z]{26}\b/gi;
const DIGITS_RE = /\d+/g;

/** Replaces ULIDs, then every run of digits, with `#` (`Order 01J8…W3 failed after 3 tries` → `Order # failed after # tries`). */
export function normaliseMessage(message: string): string {
  return message.replace(ULID_RE, '#').replace(DIGITS_RE, '#').trim();
}

/**
 * The first stack frame, trimmed (V8/Hermes `at fn (file:1:2)` or JSC `fn@file:1:2`).
 * Lines before it (the `Error: message` header) are skipped. `null` with no frame.
 */
export function topStackFrame(stack: string | null | undefined): string | null {
  if (!stack) return null;
  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('at ') || /^[^\s@]*@\S+/.test(line)) return line;
  }
  return null;
}

/** The local fingerprint: the normalised message plus the top stack frame. */
export function localFingerprint(message: string, stack: string | null | undefined): string {
  return `${normaliseMessage(message)}\n${topStackFrame(stack) ?? ''}`;
}

export type ErrorDeduper = {
  /** True the first time a fingerprint is seen in the window; false for a repeat within it. */
  shouldRecord(fingerprint: string, nowMs: number): boolean;
  /** Forgets every fingerprint (tests, sign-out). */
  clear(): void;
};

/** A 60 s de-duplicator. The window starts at the first occurrence. */
export function createErrorDeduper(windowMs: number = DEDUPE_WINDOW_MS): ErrorDeduper {
  const seen = new Map<string, number>();
  return {
    shouldRecord(fingerprint, nowMs) {
      for (const [key, at] of seen) {
        if (nowMs - at >= windowMs) seen.delete(key);
      }
      const last = seen.get(fingerprint);
      if (last !== undefined && nowMs - last < windowMs) return false;
      seen.set(fingerprint, nowMs);
      return true;
    },
    clear() {
      seen.clear();
    },
  };
}
