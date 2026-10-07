import { useRef, useState } from 'react';

import { getErrorMessage, isApiError, isApiValidationError } from '@/services/api';
import { signIn } from '@/services/session';

/** Login body fields that have their own input (contract: POST /api/v1/auth/login, revision 2). */
export type LoginField = 'email' | 'password';

const LOGIN_FIELDS: readonly LoginField[] = ['email', 'password'];

export type LoginFieldErrors = Partial<Record<LoginField, string>>;

export const RATE_LIMIT_MESSAGE = 'Too many login attempts. Please wait a minute, then try again.';

/**
 * State and submit logic for the login screen. It lives in a hook *above*
 * every layout switch, so rotating the device (phone ↔ tablet layouts,
 * single column ↔ two panes) never loses what was typed.
 *
 * Errors (contract revision 2):
 * - 422 → each message under its field (`email`, `password`); anything else in the banner
 * - 401 → the server's message ("Invalid email or password.") in the banner. The
 *   login call is `auth: false`, so the shared client never treats it as a session expiry.
 * - 403 (deactivated) → the server's message in the banner
 * - 429 → a friendly rate-limit message in the banner
 * - network / timeout / 5xx → the client's friendly message in the banner
 */
export function useLoginForm() {
  const [email, setEmailValue] = useState('');
  const [password, setPasswordValue] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const inFlight = useRef(false);

  function clearFieldError(field: LoginField) {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function setEmail(value: string) {
    setEmailValue(value);
    clearFieldError('email');
  }

  function setPassword(value: string) {
    setPasswordValue(value);
    clearFieldError('password');
  }

  function togglePasswordVisible() {
    setPasswordVisible((visible) => !visible);
  }

  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setFieldErrors({});
    setBannerError(null);

    try {
      await signIn({ email, password });
      // Success: the auth gate in _layout.tsx switches to the (pos) group.
    } catch (error) {
      if (isApiValidationError(error)) {
        const next: LoginFieldErrors = {};
        for (const field of LOGIN_FIELDS) {
          const message = error.firstError(field);
          if (message) next[field] = message;
        }
        setFieldErrors(next);
        // A 422 on a field without an input still needs to be visible.
        if (Object.keys(next).length === 0) setBannerError(error.message);
      } else if (isApiError(error) && error.status === 429) {
        setBannerError(RATE_LIMIT_MESSAGE);
      } else {
        // 401 (bad credentials), 403 (deactivated), network, timeout, 5xx.
        setBannerError(getErrorMessage(error));
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return {
    email,
    password,
    passwordVisible,
    setEmail,
    setPassword,
    togglePasswordVisible,
    fieldErrors,
    bannerError,
    submitting,
    submit,
  };
}

export type LoginFormState = ReturnType<typeof useLoginForm>;
