import {
  createErrorDeduper,
  DEDUPE_WINDOW_MS,
  localFingerprint,
  normaliseMessage,
  topStackFrame,
} from '@pos/core/errors/fingerprint';
import { DEVICE_HEALTH_LABELS, deviceHealthTone, unsyncedSalesLabel } from '@pos/core/errors/health';
import {
  ERROR_LIMITS,
  isSensitiveKey,
  REDACTED,
  redactClientError,
  redactExtra,
  redactText,
  stripQueryString,
} from '@pos/core/errors/redact';
import { compareVersions, parseVersion, versionStatus } from '@pos/core/errors/version';

describe('redactText', () => {
  it('removes bearer and Sanctum tokens', () => {
    expect(redactText('Authorization: Bearer 12|abcdefghijklmnopqrstuvwxyz0123456789ABCD')).not.toMatch(/abcdef/);
    expect(redactText('header Bearer abc.def-ghi')).toBe(`header Bearer ${REDACTED}`);
    expect(redactText('token 7|abcdefghijklmnopqrstuvwxyz0123')).toBe(`token ${REDACTED}`);
  });

  it('removes passwords and PINs in key/value and JSON form', () => {
    const out = redactText('{"email":"a@b.c","password":"hunter22","pin":"1234"} pin=9876 new_pin: 1111');
    expect(out).not.toMatch(/hunter22|1234|9876|1111|a@b\.c/);
    expect(out).toContain(`"password":"${REDACTED}"`);
  });

  it('removes customer names, phones and SC/PWD id numbers', () => {
    const out = redactText('customer_name=Juan Cruz phone: 09171234567 id_no="OSCA-123" call +63 917 123 4567');
    expect(out).not.toMatch(/Juan|09171234567|OSCA-123|917 123 4567/);
  });

  it('drops URL query strings and keeps the path', () => {
    expect(redactText('GET http://192.168.1.50:8000/api/v1/customers?search=Juan&page=2 failed')).toBe(
      'GET http://192.168.1.50:8000/api/v1/customers failed',
    );
    expect(stripQueryString('/orders/abc?x=1#y')).toBe('/orders/abc');
  });

  it('leaves ordinary text alone', () => {
    expect(redactText('TypeError: undefined is not a function')).toBe('TypeError: undefined is not a function');
    expect(redactText('Printing 2026-10-12 receipt #42')).toBe('Printing 2026-10-12 receipt #42');
  });
});

describe('redactExtra / redactClientError', () => {
  it('drops sensitive keys, non-strings and clips to 20 keys of 500 chars', () => {
    const extra: Record<string, unknown> = { password: 'x', customer_name: 'Ana', Authorization: 'y', obj: {}, ok: 'a'.repeat(900) };
    for (let i = 0; i < 30; i += 1) extra[`k${i}`] = 'v';
    const out = redactExtra(extra)!;
    expect(out.password).toBeUndefined();
    expect(out.customer_name).toBeUndefined();
    expect(out.Authorization).toBeUndefined();
    expect(out.obj).toBeUndefined();
    expect(out.ok).toHaveLength(ERROR_LIMITS.extraValue);
    expect(Object.keys(out)).toHaveLength(ERROR_LIMITS.extraKeys);
    expect(isSensitiveKey('X-Auth-Token')).toBe(true);
    expect(isSensitiveKey('order_ulid')).toBe(false);
  });

  it('redacts the whole error and clips message, stack and screen', () => {
    const out = redactClientError({
      ulid: '01J8Z3K5Q9V7X2M4N6P8R0T1W3',
      occurred_at: '2026-10-12T00:00:00Z',
      level: 'error',
      message: `password=secret ${'m'.repeat(2000)}`,
      stack: 'Error\n    at x (http://h/b.js?platform=android:1:2)',
      context: { screen: '/orders/1?tab=x', extra: { pin: '1234', step: 'print' } },
    });
    expect(out.message).toHaveLength(ERROR_LIMITS.message);
    expect(out.message).not.toContain('secret');
    expect(out.stack).not.toContain('platform=android');
    expect(out.context.screen).toBe('/orders/1');
    expect(out.context.extra).toEqual({ step: 'print' });
  });
});

describe('fingerprint', () => {
  it('normalises digits and ULIDs', () => {
    expect(normaliseMessage('Order 01J8Z3K5Q9V7X2M4N6P8R0T1W3 failed after 3 tries (500)')).toBe(
      'Order # failed after # tries (#)',
    );
  });

  it('finds the top frame in V8/Hermes and JSC stacks', () => {
    expect(topStackFrame('TypeError: x\n    at foo (a.js:1:2)\n    at bar (b.js:3:4)')).toBe('at foo (a.js:1:2)');
    expect(topStackFrame('foo@a.js:1:2\nbar@b.js:3:4')).toBe('foo@a.js:1:2');
    expect(topStackFrame(null)).toBeNull();
  });

  it('gives the same fingerprint for the same error with different numbers', () => {
    const stack = 'Error\n    at print (p.js:1:2)';
    expect(localFingerprint('Printer 3 timed out', stack)).toBe(localFingerprint('Printer 7 timed out', stack));
    expect(localFingerprint('Printer 3 timed out', stack)).not.toBe(localFingerprint('Printer 3 timed out', null));
  });

  it('counts a fingerprint once per 60 s', () => {
    const d = createErrorDeduper();
    expect(d.shouldRecord('a', 0)).toBe(true);
    expect(d.shouldRecord('a', DEDUPE_WINDOW_MS - 1)).toBe(false);
    expect(d.shouldRecord('b', 10)).toBe(true);
    expect(d.shouldRecord('a', DEDUPE_WINDOW_MS)).toBe(true);
    d.clear();
    expect(d.shouldRecord('b', 20)).toBe(true);
  });
});

describe('version', () => {
  it('parses and compares semver', () => {
    expect(parseVersion('v1.2')).toEqual([1, 2, 0]);
    expect(parseVersion('1.2.3-beta.1')).toEqual([1, 2, 3]);
    expect(parseVersion('abc')).toBeNull();
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
    expect(compareVersions('x', '1.0.0')).toBeNull();
  });

  it('derives the version status', () => {
    const info = { min_version: '1.1.0', latest_version: '1.3.0', update_url: null };
    expect(versionStatus('1.0.9', info)).toBe('update_required');
    expect(versionStatus('1.2.0', info)).toBe('update_available');
    expect(versionStatus('1.3.0', info)).toBe('up_to_date');
    expect(versionStatus('garbage', info)).toBe('up_to_date');
  });
});

describe('health wording', () => {
  it('labels every health', () => {
    expect(DEVICE_HEALTH_LABELS.attention).toBe('Needs attention');
    expect(deviceHealthTone('offline')).toBe('danger');
    expect(unsyncedSalesLabel(1)).toBe('1 unsynced sale');
    expect(unsyncedSalesLabel(5)).toBe('5 unsynced sales');
    expect(unsyncedSalesLabel(0)).toBeNull();
  });
});
