/**
 * ULIDs for idempotency keys and client ids (orders, shifts, print jobs, the
 * terminal's `install_id`). The `ulid` package uses the browser's
 * `crypto.getRandomValues`; the result is uppercase Crockford base32, which
 * matches the contract's `^[0-7][0-9A-HJKMNP-TV-Z]{25}$`.
 */
import { ulid as makeUlid } from 'ulid';

export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function ulid(): string {
  return makeUlid();
}

export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && ULID_PATTERN.test(value);
}
