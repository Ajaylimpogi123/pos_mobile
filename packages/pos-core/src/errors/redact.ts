import type { ClientError, ClientErrorContext } from '../contract/types';

/**
 * Hardening & Pilot §F redaction: what may never leave the device in an error
 * report. Applied by both apps BEFORE an error is queued.
 *
 * - Authorization headers, bearer and Sanctum tokens, PINs and passwords.
 * - URL query strings (`?…` is dropped, the path is kept).
 * - Customer names, phone numbers and SC/PWD ID numbers (by key, plus phone patterns).
 *
 * Request and response bodies are never attached in the first place: callers
 * pass only a message, a stack and the small `context`.
 */

/** The placeholder that replaces a redacted value. */
export const REDACTED = '[redacted]';

/** §B limits (the server truncates too; truncating here keeps the queue small). */
export const ERROR_LIMITS = {
  message: 1000,
  stack: 16000,
  screen: 120,
  appVersion: 20,
  os: 20,
  osVersion: 20,
  deviceModel: 60,
  extraKeys: 20,
  extraValue: 500,
} as const;

/**
 * Keys whose values are never sent (case-insensitive, `-`/`_` ignored):
 * credentials, PINs, customer identity and SC/PWD ID numbers.
 */
const SENSITIVE_KEY_PARTS = [
  'authorization',
  'password',
  'passwd',
  'pin',
  'token',
  'secret',
  'cookie',
  'apikey',
  'customer',
  'phone',
  'mobile',
  'contact',
  'idno',
  'osca',
  'pwdid',
  'email',
] as const;

/** True when a key (header, field or `extra` key) names something that must never be sent. */
export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[-_\s]/g, '');
  if (k === 'name' || k === 'fullname') return true;
  return SENSITIVE_KEY_PARTS.some((part) => k.includes(part));
}

const KEY_NAMES =
  'authorization|x-?auth[-_]?token|access[-_]?token|refresh[-_]?token|api[-_]?key|token|secret|cookie|' +
  'password(?:[-_]confirmation)?|current[-_]password|new[-_]password|passwd|' +
  '(?:new[-_]|current[-_])?pin|' +
  'customer[-_]?name|customer|phone(?:[-_]?no)?|mobile(?:[-_]?no)?|contact[-_]?no|id[-_]?no|osca[-_]?id|pwd[-_]?id|email';

/** `key: value`, `key=value`, `"key":"value"` for every sensitive key. */
const KEY_VALUE_RE = new RegExp(
  `(["']?)\\b(${KEY_NAMES})\\1(\\s*[:=]\\s*)("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|Bearer\\s+\\S+|[^\\s,;&}\\]]+)`,
  'gi',
);

/** `Bearer <token>` anywhere. */
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=|-]+/gi;

/** A Sanctum plain-text token: `<id>|<40+ chars>`. */
const SANCTUM_TOKEN_RE = /\b\d+\|[A-Za-z0-9]{20,}\b/g;

/** Philippine mobile and landline numbers (+63 / 09…, with optional separators). */
const PHONE_RE = /(?:\+?63|\b0)[\s-]?9\d{2}[\s-]?\d{3}[\s-]?\d{4}\b|\(0\d{1,2}\)\s?\d{3,4}[\s-]?\d{4}\b/g;

/** Any URL: the query string and fragment are dropped. */
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;

/** Drops a URL's query string and fragment (`https://h/p?a=1#x` → `https://h/p`). Non-URLs lose `?…` too. */
export function stripQueryString(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** Redacts free text: tokens, credentials and customer data by key, phone numbers, URL query strings. */
export function redactText(text: string): string {
  return text
    .replace(URL_RE, (url) => stripQueryString(url))
    .replace(KEY_VALUE_RE, (_m, quote: string, key: string, sep: string, value: string) => {
      const q = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : '';
      return `${quote}${key}${quote}${sep}${q}${REDACTED}${q}`;
    })
    .replace(BEARER_RE, `Bearer ${REDACTED}`)
    .replace(SANCTUM_TOKEN_RE, REDACTED)
    .replace(PHONE_RE, REDACTED);
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function clipNullable(value: string | null | undefined, max: number): string | null | undefined {
  return typeof value === 'string' ? clip(value, max) : value;
}

/**
 * Redacts and limits `context.extra`: sensitive keys are dropped, values are
 * redacted text, at most 20 keys of at most 500 characters. Non-string values are dropped.
 */
export function redactExtra(extra: Record<string, unknown> | null | undefined): Record<string, string> | null {
  if (!extra) return null;
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(extra)) {
    if (count >= ERROR_LIMITS.extraKeys) break;
    if (isSensitiveKey(key)) continue;
    let text: string;
    if (typeof value === 'string') text = value;
    else if (typeof value === 'number' || typeof value === 'boolean') text = String(value);
    else continue;
    out[key] = clip(redactText(text), ERROR_LIMITS.extraValue);
    count += 1;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Redacts a context: the screen loses its query string; free-text fields are clipped to §B. */
export function redactContext(context: ClientErrorContext): ClientErrorContext {
  return {
    ...context,
    screen: clipNullable(
      typeof context.screen === 'string' ? stripQueryString(context.screen) : context.screen,
      ERROR_LIMITS.screen,
    ),
    app_version: clipNullable(context.app_version, ERROR_LIMITS.appVersion),
    os: clipNullable(context.os, ERROR_LIMITS.os),
    os_version: clipNullable(context.os_version, ERROR_LIMITS.osVersion),
    device_model: clipNullable(context.device_model, ERROR_LIMITS.deviceModel),
    extra: redactExtra(context.extra ?? null),
  };
}

/** Redacts a whole `ClientError` (message, stack and context), clipped to the §B limits. */
export function redactClientError(error: ClientError): ClientError {
  return {
    ...error,
    message: clip(redactText(error.message), ERROR_LIMITS.message) || 'Unknown error',
    stack: error.stack === null ? null : clip(redactText(error.stack), ERROR_LIMITS.stack),
    context: redactContext(error.context),
  };
}
