import { useEffect, useRef, useState } from 'react';

import { getErrorMessage, isApiError, isApiValidationError } from '@/services/api';
import { getDeviceCode } from '@/services/secureStorage';
import { signIn } from '@/services/session';

/** Login body fields that have their own input (contract: POST /api/v1/auth/login). */
export type LoginField = 'email' | 'password' | 'device_code';

const LOGIN_FIELDS: readonly LoginField[] = ['email', 'password', 'device_code'];

export type LoginFieldErrors = Partial<Record<LoginField, string>>;

const RATE_LIMIT_MESSAGE = 'Too many login attempts. Please wait a minute, then try again.';

/**
 * State and submit logic for the login screen:
 * - prefills the remembered device code
 * - shows 422 messages under their fields, and 429 / other errors in a banner
 * - blocks double submits while a request is in flight
 */
export function useLoginForm() {
  const [email, setEmailValue] = useState('');
  const [password, setPasswordValue] = useState('');
  const [deviceCode, setDeviceCodeValue] = useState('');
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const deviceCodeTouched = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getDeviceCode()
      .then((remembered) => {
        if (!cancelled && remembered && !deviceCodeTouched.current) setDeviceCodeValue(remembered);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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

  function setDeviceCode(value: string) {
    deviceCodeTouched.current = true;
    setDeviceCodeValue(value);
    clearFieldError('device_code');
  }

  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setFieldErrors({});
    setBannerError(null);

    try {
      await signIn({ email, password, deviceCode });
      // Success: the auth gate in _layout.tsx switches to the (pos) group.
    } catch (error) {
      if (isApiValidationError(error)) {
        const next: LoginFieldErrors = {};
        for (const field of LOGIN_FIELDS) {
          const message = error.firstError(field);
          if (message) next[field] = message;
        }
        setFieldErrors(next);
        // A 422 on a field without an input (e.g. app_version) still needs to be visible.
        if (Object.keys(next).length === 0) setBannerError(error.message);
      } else if (isApiError(error) && error.status === 429) {
        setBannerError(RATE_LIMIT_MESSAGE);
      } else {
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
    deviceCode,
    setEmail,
    setPassword,
    setDeviceCode,
    fieldErrors,
    bannerError,
    submitting,
    submit,
  };
}
