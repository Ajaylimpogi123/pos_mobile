/**
 * The app's single HTTP client. Screens, hooks and stores never call `fetch`
 * directly: they call a service function in `src/services/<feature>.ts`, which
 * calls this client.
 *
 * Behaviour (docs/api-contract.md → Global Conventions):
 * - Base URL from EXPO_PUBLIC_API_URL (server origin, no trailing slash). Fails loud when missing.
 * - `Accept: application/json` on every request; `Content-Type: application/json` when there is a body.
 * - `Authorization: Bearer <token>` from expo-secure-store on authenticated requests.
 * - 401 → clear the stored session and state, then `router.replace('/login')` (loop-guarded).
 * - 422 → throws `ApiValidationError` carrying `message` and `errors` (field → string[]).
 * - Any other failure → throws `ApiError` with the server's `message`, or a friendly fallback.
 */
import { router } from 'expo-router';

import { clearSession, getToken } from '@/services/secureStorage';
import type { ApiErrorBody, ValidationErrorBody } from '@/services/types';
import { useSessionStore } from '@/stores/session';

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------

function readBaseUrl(): string {
  // Must be the literal `process.env.EXPO_PUBLIC_API_URL` so Expo can inline it.
  const raw = process.env.EXPO_PUBLIC_API_URL;
  if (!raw || raw.trim() === '') {
    throw new Error(
      '[api] EXPO_PUBLIC_API_URL is not set. Copy mobile/.env.example to mobile/.env, set it to the ' +
        "API server's LAN origin (e.g. http://192.168.1.50:8000), then restart Metro with `npx expo start --clear`.",
    );
  }
  return raw.trim().replace(/\/+$/, '');
}

/** Server origin, e.g. `http://192.168.1.50:8000`. Evaluated once, at startup. */
export const API_BASE_URL = readBaseUrl();

/** Requests are aborted after this long and reported as a timeout. */
export const REQUEST_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ApiErrorKind = 'http' | 'network' | 'timeout';

export const NETWORK_ERROR_MESSAGE =
  "Can't reach the server. Check the tablet's Wi-Fi connection and try again.";
export const TIMEOUT_ERROR_MESSAGE = 'The server took too long to respond. Please try again.';
export const SESSION_EXPIRED_MESSAGE = 'Your session has ended. Please log in again.';

/** Any failed request: an HTTP error status, a network failure, or a timeout. */
export class ApiError extends Error {
  /** HTTP status, or `null` for network failures and timeouts. */
  readonly status: number | null;
  readonly kind: ApiErrorKind;

  constructor(message: string, options: { status: number | null; kind: ApiErrorKind }) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ApiError';
    this.status = options.status;
    this.kind = options.kind;
  }
}

/** HTTP 422. `errors` maps each field name to its messages. */
export class ApiValidationError extends ApiError {
  readonly errors: Record<string, string[]>;

  constructor(message: string, errors: Record<string, string[]>) {
    super(message, { status: 422, kind: 'http' });
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ApiValidationError';
    this.errors = errors;
  }

  /** First message for a field, or `null`. */
  firstError(field: string): string | null {
    return this.errors[field]?.[0] ?? null;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isApiValidationError(error: unknown): error is ApiValidationError {
  return error instanceof ApiValidationError;
}

/** Best user-facing message for any thrown value. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}

function fallbackMessage(status: number): string {
  if (status === 401) return SESSION_EXPIRED_MESSAGE;
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) return 'Not found.';
  if (status === 429) return 'Too many attempts. Please wait a minute and try again.';
  if (status >= 500) return 'The server had a problem. Please try again.';
  return `Request failed (HTTP ${status}).`;
}

// ---------------------------------------------------------------------------
// 401 handling (loop-guarded)
// ---------------------------------------------------------------------------

let unauthorizedInFlight: Promise<void> | null = null;

/**
 * Clears the stored token + session state and sends the user to login.
 * - Parallel 401s share one in-flight handler.
 * - The redirect only happens on the signedIn → signedOut transition, so a
 *   burst of 401s (or a 401 while restoring / already signed out) never
 *   loops or stacks navigations.
 * - A 401 for a token that has since been replaced (a newer login) is ignored.
 */
function handleUnauthorized(tokenUsed: string | null): Promise<void> {
  if (unauthorizedInFlight) return unauthorizedInFlight;

  unauthorizedInFlight = (async () => {
    const currentToken = await getToken().catch(() => null);
    if (tokenUsed !== null && currentToken !== null && currentToken !== tokenUsed) return;

    const session = useSessionStore.getState();
    const wasSignedIn = session.status === 'signedIn';

    await clearSession().catch(() => undefined);
    session.setSignedOut();

    if (wasSignedIn) {
      // Defer so the auth gate re-renders with the new status before navigating.
      setTimeout(() => {
        try {
          router.replace('/login');
        } catch {
          // Navigation not mounted yet: the auth gate in _layout.tsx shows login anyway.
        }
      }, 0);
    }
  })().finally(() => {
    unauthorizedInFlight = null;
  });

  return unauthorizedInFlight;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type RequestOptions = {
  method?: HttpMethod;
  /** JSON body. Sent with `Content-Type: application/json`. */
  body?: unknown;
  /** Attach the Bearer token (default `true`). Endpoints marked "Auth: no" pass `false`. */
  auth?: boolean;
  /** Extra headers, e.g. `Idempotency-Key`. */
  headers?: Record<string, string>;
  timeoutMs?: number;
};

function parseJson(text: string): unknown {
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readMessage(body: unknown): string | null {
  if (body && typeof body === 'object' && 'message' in body) {
    const { message } = body as ApiErrorBody;
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  return null;
}

function readErrors(body: unknown): Record<string, string[]> {
  if (body && typeof body === 'object' && 'errors' in body) {
    const { errors } = body as ValidationErrorBody;
    if (errors && typeof errors === 'object') return errors;
  }
  return {};
}

/**
 * Sends a request to `API_BASE_URL + path` and returns the parsed JSON body
 * (or `undefined` for 204 / empty bodies).
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, headers: extraHeaders, timeoutMs = REQUEST_TIMEOUT_MS } = options;

  const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let tokenUsed: string | null = null;
  if (auth) {
    tokenUsed = await getToken().catch(() => null);
    if (tokenUsed) headers.Authorization = `Bearer ${tokenUsed}`;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    if (timedOut) throw new ApiError(TIMEOUT_ERROR_MESSAGE, { status: null, kind: 'timeout' });
    throw new ApiError(NETWORK_ERROR_MESSAGE, { status: null, kind: 'network' });
  } finally {
    clearTimeout(timer);
  }

  let text = '';
  try {
    text = response.status === 204 ? '' : await response.text();
  } catch {
    // Body could not be read; fall through with an empty body.
  }
  const parsed = parseJson(text);

  if (response.ok) return parsed as T;

  const message = readMessage(parsed) ?? fallbackMessage(response.status);

  if (response.status === 401 && auth) {
    await handleUnauthorized(tokenUsed);
    throw new ApiError(SESSION_EXPIRED_MESSAGE, { status: 401, kind: 'http' });
  }

  if (response.status === 422) {
    throw new ApiValidationError(message, readErrors(parsed));
  }

  throw new ApiError(message, { status: response.status, kind: 'http' });
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
};
