/**
 * The web app's single HTTP client. Pages, components and hooks never call
 * `fetch`: they call a service function (`src/services/<feature>.ts`), which
 * calls this client (docs/api-contract.md → Global Conventions, Web POS §B/§F).
 *
 * - URLs are **relative** (`/api/v1/...`): the app is same-origin (the Vite
 *   proxy in dev, Laravel's `/pos` route in production). Never a host.
 * - `Accept: application/json` always; `Content-Type: application/json` on a
 *   JSON body. A `FormData` body goes out as multipart (fetch sets the boundary).
 * - `Authorization: Bearer <token>` from `localStorage` `pos.token` (`./token`).
 * - **401** on an authenticated request → clear the token and the session,
 *   then the registered handler resets the query cache and goes to `/login`
 *   (replace). Parallel 401s share one handling, and a 401 for a token that
 *   has since been replaced is ignored. A 401 from an `auth: false` call
 *   (login's "Invalid email or password.") is a plain error for the form.
 * - **5xx** → reported to the error capture (`setServerErrorReporter`), then thrown.
 * - **422** → `ApiValidationError` with `message` and `errors` (field → string[]).
 * - Anything else (403, 404, 409, 429, 5xx, network, timeout) → `ApiError`
 *   with the server's `message`, or a friendly fallback.
 */
import { clearToken, getToken } from '@/services/token';
import type { ApiErrorBody, ValidationErrorBody } from '@/services/types';

/** Requests are aborted after this long and reported as a timeout. */
export const REQUEST_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ApiErrorKind = 'http' | 'network' | 'timeout';

export const NETWORK_ERROR_MESSAGE = "Can't reach the server. Check this computer's network connection and try again.";
export const TIMEOUT_ERROR_MESSAGE = 'The server took too long to respond. Please try again.';
export const SESSION_EXPIRED_MESSAGE = 'Your session has ended. Please log in again.';
export const LOGIN_FAILED_MESSAGE = 'Login failed. Check your email and password.';
/** Web POS §B: the 403 wording. */
export const FORBIDDEN_MESSAGE = "You don't have permission to do that.";

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

/** HTTP 422. `errors` maps each field name (dot notation) to its messages. */
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
  if (status === 401 && !auth) return LOGIN_FAILED_MESSAGE;
  if (status === 401) return SESSION_EXPIRED_MESSAGE;
  if (status === 403) return FORBIDDEN_MESSAGE;
  if (status === 404) return 'Not found.';
  if (status === 409) return 'This conflicts with the current data. Refresh and try again.';
  if (status === 429) return 'Too many attempts. Please wait a minute and try again.';
  if (status >= 500) return 'The server had a problem. Please try again.';
  return `Request failed (HTTP ${status}).`;
}

// ---------------------------------------------------------------------------
// 401 handling (loop-guarded)
// ---------------------------------------------------------------------------

/** Hardening & Pilot §C: the 401 a token bound to a retired terminal gets (shown on the login page). */
export const RETIRED_TERMINAL_MESSAGE = 'This tablet has been retired.';

/** `message`: the server's 401 message, or `null`. */
type UnauthorizedHandler = (message: string | null) => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;
/** The token whose 401 was already handled: later 401s for it are ignored. */
let handledToken: string | null = null;

/** The app shell registers what a 401 does beyond clearing the token (session, cache, redirect). */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

function handleUnauthorized(tokenUsed: string | null, message: string | null): void {
  const current = getToken();
  // A 401 for a token that a newer login already replaced: not this session's problem.
  if (tokenUsed !== null && current !== null && current !== tokenUsed) return;
  // Parallel requests all fail with the same token: handle it once.
  if (tokenUsed !== null && handledToken === tokenUsed) return;
  handledToken = tokenUsed;
  clearToken();
  unauthorizedHandler?.(message);
}

// ---------------------------------------------------------------------------
// Unexpected 5xx (Hardening & Pilot §I: a "caught error worth knowing")
// ---------------------------------------------------------------------------

/** What is reported about a 5xx: never a body, a header or the query string. */
export type ServerErrorReport = { method: HttpMethod; path: string; status: number; message: string };

type ServerErrorReporter = (report: ServerErrorReport) => void;

let serverErrorReporter: ServerErrorReporter | null = null;

/** The error capture registers itself here; the client never imports it (no cycle). */
export function setServerErrorReporter(reporter: ServerErrorReporter | null): void {
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
  /** A `FormData` goes out as multipart; anything else is JSON-encoded. */
  body?: unknown;
  /** Attach the Bearer token (default `true`). "Auth: no" endpoints pass `false`. */
  auth?: boolean;
  /** Extra headers, e.g. `Idempotency-Key`. */
  headers?: Record<string, string>;
  timeoutMs?: number;
};

type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];

/**
 * `?a=1&b=x` from a params object, skipping `undefined`, `null` and empty
 * strings. Booleans go as `1` / `0` (Laravel's `boolean` rule). An array goes
 * as repeated `key[]=` pairs (e.g. `ulids[]`).
 */
export function buildQuery(params: Record<string, QueryValue>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) parts.push(`${encodeURIComponent(`${key}[]`)}=${encodeURIComponent(String(item))}`);
      continue;
    }
    const text = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
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

function isFormData(body: unknown): body is FormData {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

type Sent = { response: Response; tokenUsed: string | null; auth: boolean; method: HttpMethod; path: string };

/** Sends a request to the same-origin `path` (headers, token, timeout); network failures and timeouts throw. */
async function send(path: string, options: RequestOptions): Promise<Sent> {
  const { method = 'GET', body, auth = true, headers: extraHeaders, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  if (!path.startsWith('/api/')) throw new Error(`[api] Relative /api/ paths only, got ${path}`);

  const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders };
  const multipart = isFormData(body);
  if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json';

  let tokenUsed: string | null = null;
  if (auth) {
    tokenUsed = getToken();
    if (tokenUsed) headers.Authorization = `Bearer ${tokenUsed}`;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
      signal: controller.signal,
      credentials: 'same-origin',
    });
    return { response, tokenUsed, auth, method, path };
  } catch {
    if (timedOut) throw new ApiError(TIMEOUT_ERROR_MESSAGE, { status: null, kind: 'timeout' });
    throw new ApiError(NETWORK_ERROR_MESSAGE, { status: null, kind: 'network' });
  } finally {
    window.clearTimeout(timer);
  }
}

async function readText(response: Response): Promise<string> {
  try {
    return response.status === 204 ? '' : await response.text();
  } catch {
    // The body couldn't be read; continue with an empty one.
    return '';
  }
}

/** The error a failed response throws (401 handling, typed 422, the 403 wording). */
function failure({ response, tokenUsed, auth, method, path }: Sent, text: string): ApiError {
  const parsed = parseJson(text);
  const serverMessage = readMessage(parsed);
  const message = serverMessage ?? fallbackMessage(response.status, auth);

  if (response.status >= 500) {
    // The path only: the query string can carry search terms.
    reportServerError({ method, path: path.split('?')[0] ?? path, status: response.status, message });
  }
  if (response.status === 401 && auth) {
    handleUnauthorized(tokenUsed, serverMessage);
    return new ApiError(SESSION_EXPIRED_MESSAGE, { status: 401, kind: 'http' });
  }
  if (response.status === 422) return new ApiValidationError(message, readErrors(parsed));
  // Web POS §B: a plain 403 reads "You don't have permission to do that."; a feature's own 403 message is kept.
  if (response.status === 403 && message === 'This action is unauthorized.') {
    return new ApiError(FORBIDDEN_MESSAGE, { status: 403, kind: 'http' });
  }
  return new ApiError(message, { status: response.status, kind: 'http' });
}

/** Sends a request to the same-origin `path` and returns the parsed JSON body (`undefined` for 204). */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const sent = await send(path, options);
  const text = await readText(sent.response);
  if (sent.response.ok) return parseJson(text) as T;
  throw failure(sent, text);
}

/** A downloaded file: the body as a Blob and the server's `Content-Disposition` header (or `null`). */
export type ApiDownload = { blob: Blob; contentDisposition: string | null };

/** Exports can take longer than a JSON read. */
export const DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * GET a file (e.g. a CSV export) through the same client: the Bearer token
 * goes in the header, never in the URL. A success is returned as a Blob; the
 * errors are JSON and are thrown exactly like `apiRequest`'s (401, 422, 403…).
 * `Accept` stays `application/json` (Global Conventions); the export answers CSV anyway.
 */
export async function apiDownload(path: string, options: NoBody = {}): Promise<ApiDownload> {
  const sent = await send(path, { timeoutMs: DOWNLOAD_TIMEOUT_MS, ...options, method: 'GET' });
  if (!sent.response.ok) throw failure(sent, await readText(sent.response));
  let blob: Blob;
  try {
    blob = await sent.response.blob();
  } catch {
    throw new ApiError(NETWORK_ERROR_MESSAGE, { status: null, kind: 'network' });
  }
  return { blob, contentDisposition: sent.response.headers.get('Content-Disposition') };
}

/** A new session started (login): its token's 401 may be handled again. */
export function resetUnauthorizedGuard(): void {
  handledToken = null;
}

type NoBody = Omit<RequestOptions, 'method' | 'body'>;

export const api = {
  get: <T>(path: string, options?: NoBody) => apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: NoBody) => apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: NoBody) => apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: NoBody) => apiRequest<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: NoBody) => apiRequest<T>(path, { ...options, method: 'DELETE' }),
};
