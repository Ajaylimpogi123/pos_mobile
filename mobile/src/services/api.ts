/**
 * The app's single HTTP client. Screens, hooks and stores never call `fetch`
 * directly: they call a service function in `src/services/<feature>.ts`, which
 * calls this client.
 *
 * Behaviour (docs/api-contract.md → Global Conventions):
 * - Base URL from EXPO_PUBLIC_API_URL (server origin, no trailing slash). Fails loud when missing.
 * - `Accept: application/json` on every request; `Content-Type: application/json` when there is a JSON body.
 * - A `FormData` body is sent as-is as `multipart/form-data` (Global Conventions → File uploads): no
 *   `Content-Type` header is set, so fetch adds the multipart boundary itself, and it is never JSON.stringified.
 * - `Authorization: Bearer <token>` from expo-secure-store on authenticated requests.
 * - 401 on an authenticated request → clear the stored session and state, then
 *   `router.replace('/login')` (loop-guarded). A 401 from an `auth: false` call (login's
 *   "Invalid email or password.") is thrown as a plain `ApiError` and never touches the session.
 * - 422 → throws `ApiValidationError` carrying `message` and `errors` (field → string[]).
 * - Any other failure → throws `ApiError` with the server's `message`, or a friendly fallback.
 * - Server reachability (Offline Sales hardening): any HTTP response marks the
 *   server reachable, and a network error or timeout marks it unreachable
 *   (`@/stores/connectivity`). `probeServer()` checks it with `GET /up`.
 * - Hardening & Pilot §F: an unexpected 5xx is passed to the reporter registered
 *   with `setServerErrorReporter` (the app's error capture), with the method, the
 *   path without its query string, the status and the message. Never the body.
 */
import { router } from 'expo-router';

import { clearSession, getToken } from '@/services/secureStorage';
import type { ApiErrorBody, ValidationErrorBody } from '@/services/types';
import { useConnectivityStore } from '@/stores/connectivity';
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
/** Hardening & Pilot §C: the 401 of a token bound to a retired device. */
export const RETIRED_TABLET_MESSAGE = 'This tablet has been retired.';
/** Fallback only: login's 401 normally carries the server's own message. */
export const LOGIN_FAILED_MESSAGE = 'Login failed. Check your email and password.';

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

function fallbackMessage(status: number, auth: boolean): string {
  // Unauthenticated calls (login) get 401 for bad credentials, not for an expired session.
  if (status === 401 && !auth) return LOGIN_FAILED_MESSAGE;
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
// 5xx reporting (Hardening & Pilot §F)
// ---------------------------------------------------------------------------

export type ServerErrorReport = { method: HttpMethod; path: string; status: number; message: string };

let serverErrorReporter: ((report: ServerErrorReport) => void) | null = null;

/** Registers (or clears) the reporter of unexpected 5xx answers. It must never throw. */
export function setServerErrorReporter(reporter: ((report: ServerErrorReport) => void) | null): void {
  serverErrorReporter = reporter;
}

function reportServerError(report: ServerErrorReport): void {
  try {
    serverErrorReporter?.(report);
  } catch {
    // Reporting never changes the request's outcome.
  }
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type RequestOptions = {
  method?: HttpMethod;
  /**
   * Request body. A `FormData` is sent as multipart (fetch sets the boundary
   * `Content-Type`); anything else is JSON-encoded with `Content-Type: application/json`.
   */
  body?: unknown;
  /** Attach the Bearer token (default `true`). Endpoints marked "Auth: no" pass `false`. */
  auth?: boolean;
  /** Extra headers, e.g. `Idempotency-Key`. */
  headers?: Record<string, string>;
  timeoutMs?: number;
};

/** True for a multipart body. Guarded: `FormData` exists in React Native and Node, but not every test env. */
function isFormData(body: unknown): body is FormData {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

type QueryValue = string | number | boolean | null | undefined;

/**
 * Builds `?a=1&b=x` from a params object, skipping `undefined`, `null` and
 * empty strings. Booleans are sent as `1` / `0`, which Laravel's `boolean`
 * rule accepts (it rejects the strings "true" / "false").
 */
export function buildQuery(params: Record<string, QueryValue>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    let text: string;
    if (typeof value === 'boolean') text = value ? '1' : '0';
    else text = String(value);
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(text)}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

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

/** A successful answer: the raw body text, and a response header reader. */
type RawResponse = {
  text: string;
  header: (name: string) => string | null;
};

/**
 * Sends a request to `API_BASE_URL + path` and returns the parsed JSON body
 * (or `undefined` for 204 / empty bodies).
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { text } = await execute(path, options);
  return parseJson(text) as T;
}

/**
 * Like `apiRequest`, for the one endpoint that doesn't answer with JSON
 * (Shifts & Reporting: `GET /reports/sales/export` is `text/csv`). The same
 * headers, 401 handling and typed errors apply (its errors are still JSON).
 * Returns the body as text and the value of `Content-Disposition` (`null`
 * when the response has none).
 */
export async function apiRequestText(
  path: string,
  options: Omit<RequestOptions, 'method' | 'body'> = {},
): Promise<{ text: string; contentDisposition: string | null }> {
  const { text, header } = await execute(path, { ...options, method: 'GET' });
  return { text, contentDisposition: header('Content-Disposition') };
}

/** Reads a response header; `null` when missing (or when a test double has no `headers`). */
function headerReader(response: Response): (name: string) => string | null {
  return (name) => {
    try {
      return response.headers?.get?.(name) ?? null;
    } catch {
      return null;
    }
  };
}

/** The request itself: headers, token, timeout, reachability, and every error rule. Returns the body text of a 2xx. */
async function execute(path: string, options: RequestOptions): Promise<RawResponse> {
  const { method = 'GET', body, auth = true, headers: extraHeaders, timeoutMs = REQUEST_TIMEOUT_MS } = options;

  const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders };
  const multipart = isFormData(body);
  // Multipart: leave Content-Type unset so fetch writes `multipart/form-data; boundary=…`.
  if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json';

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
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    useConnectivityStore.getState().setServerReachable(false);
    if (timedOut) throw new ApiError(TIMEOUT_ERROR_MESSAGE, { status: null, kind: 'timeout' });
    throw new ApiError(NETWORK_ERROR_MESSAGE, { status: null, kind: 'network' });
  } finally {
    clearTimeout(timer);
  }
  // Any HTTP answer, whatever its status, means the server can be reached.
  useConnectivityStore.getState().setServerReachable(true);

  let text = '';
  try {
    text = response.status === 204 ? '' : await response.text();
  } catch {
    // Body could not be read; fall through with an empty body.
  }
  if (response.ok) return { text, header: headerReader(response) };

  const parsed = parseJson(text);
  const message = readMessage(parsed) ?? fallbackMessage(response.status, auth);

  if (response.status === 401 && auth) {
    // Phase 8 §C: a retired tablet's token. Signed out like any 401; login then says why.
    if (readMessage(parsed) === RETIRED_TABLET_MESSAGE) useSessionStore.getState().setLoginNotice(RETIRED_TABLET_MESSAGE);
    await handleUnauthorized(tokenUsed);
    throw new ApiError(SESSION_EXPIRED_MESSAGE, { status: 401, kind: 'http' });
  }

  if (response.status === 422) {
    throw new ApiValidationError(message, readErrors(parsed));
  }

  if (response.status >= 500) {
    reportServerError({ method, path: path.split('?')[0], status: response.status, message });
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

// ---------------------------------------------------------------------------
// Server reachability probe (Offline Sales hardening)
// ---------------------------------------------------------------------------

/** Laravel's health route (no auth). */
export const HEALTH_PATH = '/up';
export const PROBE_TIMEOUT_MS = 3_000;

/**
 * `GET /up` with a 3 s timeout, without the token: `true` when the server
 * answers with any HTTP status (the request itself updates the connectivity
 * store), `false` on a network error or timeout. Never rejects.
 */
export async function probeServer(): Promise<boolean> {
  try {
    await apiRequest<unknown>(HEALTH_PATH, { auth: false, timeoutMs: PROBE_TIMEOUT_MS });
    return true;
  } catch (error) {
    return isApiError(error) && error.kind === 'http';
  }
}
