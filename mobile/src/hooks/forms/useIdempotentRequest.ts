import { useRef, useState } from 'react';

import type { FieldErrors } from '@/hooks/forms/formErrors';
import { getErrorMessage, isApiError, isApiValidationError } from '@/services/api';
import { ulid } from '@/utils/ulid';

type IdempotentRequestOptions<B, R, F extends string> = {
  /** Sends `body` with its ULID (the body's `ulid` and the `Idempotency-Key`). */
  request: (ulid: string, body: B) => Promise<R>;
  /** Which form field a 422 key lands on (`null`: the banner). */
  fieldOf: (apiField: string) => F | null;
  /** The banner after a network error or a timeout (the attempt may have succeeded). */
  unconfirmedMessage: string;
};

/**
 * The idempotent-write core (Global Conventions → Idempotent requests), shared
 * by every screen that creates a record with a client ULID: stock
 * adjustments, ingredient adjustments, purchase requests and receipts.
 * - The ULID is generated for the first attempt and reused on every retry
 *   until a 2xx (a failed request never uses it up), so a retry after a
 *   timeout can't write twice.
 * - After a network error or a timeout the attempt is **unconfirmed**: the
 *   body is locked, and the next `send` resends exactly that body (Retry).
 *   Any other HTTP answer (except a 409) unlocks it, so the user can correct it.
 * - 422s go under their fields (`fieldOf`); anything else is a banner.
 */
export function useIdempotentRequest<B, R, F extends string>({ request, fieldOf, unconfirmedMessage }: IdempotentRequestOptions<B, R, F>) {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<F>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const pendingUlid = useRef<string | null>(null);
  const lockedBody = useRef<B | null>(null);
  const inFlight = useRef(false);

  function unlock() {
    lockedBody.current = null;
    setUnconfirmed(false);
  }

  /**
   * Sends `body`, or (`null`, or while an attempt is unconfirmed) resends the
   * locked body. Resolves with the response on a 2xx, else `null`.
   */
  async function send(body: B | null): Promise<R | null> {
    if (inFlight.current) return null;
    const sent = lockedBody.current ?? body;
    if (sent === null) return null;
    if (pendingUlid.current === null) pendingUlid.current = ulid();

    inFlight.current = true;
    setBusy(true);
    setBanner(null);
    try {
      const result = await request(pendingUlid.current, sent);
      pendingUlid.current = null;
      unlock();
      setFieldErrors({});
      return result;
    } catch (error) {
      if (isApiError(error) && (error.kind === 'network' || error.kind === 'timeout')) {
        lockedBody.current = sent;
        setUnconfirmed(true);
        setBanner(unconfirmedMessage);
        return null;
      }
      if (!(isApiError(error) && error.status === 409)) unlock();
      if (isApiValidationError(error)) {
        const next: FieldErrors<F> = {};
        let unmatched = false;
        for (const [apiField, messages] of Object.entries(error.errors)) {
          const field = fieldOf(apiField);
          if (field && messages[0] && !next[field]) next[field] = messages[0];
          else if (!field) unmatched = true;
        }
        setFieldErrors(next);
        if (unmatched || Object.keys(next).length === 0) setBanner(error.message);
      } else {
        setBanner(getErrorMessage(error));
      }
      return null;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return {
    send,
    busy,
    banner,
    fieldErrors,
    setFieldErrors,
    /** The last attempt got no answer: the body is locked and the next send retries it. */
    unconfirmed,
    /** A ULID is waiting for its 2xx (the last attempt failed): keep the typed values for the retry. */
    hasPending: () => pendingUlid.current !== null,
    /** The ULID the next attempt will use (`null` until the first attempt). */
    pendingUlid: () => pendingUlid.current,
    isInFlight: () => inFlight.current,
    clearField: (field: F) =>
      setFieldErrors((current) => {
        if (!current[field]) return current;
        const next = { ...current };
        delete next[field];
        return next;
      }),
    clearMessages: () => {
      setBanner(null);
      setFieldErrors({});
    },
  };
}

export type IdempotentRequestState<B, R, F extends string> = ReturnType<typeof useIdempotentRequest<B, R, F>>;
