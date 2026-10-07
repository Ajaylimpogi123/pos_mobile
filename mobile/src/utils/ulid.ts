/**
 * ULIDs for transactional rows (PROJECT_MEMORY §8.2): generated on the
 * device, used as the row's public id and as the `Idempotency-Key`.
 *
 * Format (docs/api-contract.md → POST /orders → `ulid`): 26 characters of
 * uppercase Crockford base32, `^[0-7][0-9A-HJKMNP-TV-Z]{25}$`: a 48-bit
 * millisecond timestamp (10 characters) then 80 random bits (16 characters).
 *
 * - **Randomness** comes from a cryptographically secure source: expo-crypto's
 *   native `getRandomBytes`. SDK 57's Hermes runtime doesn't guarantee a
 *   global `crypto.getRandomValues`, so it is never relied on.
 * - **Monotonic:** ULIDs made in the same millisecond (or after the clock
 *   stepped back) keep the previous timestamp and increment the random part,
 *   so every ULID from one device sorts after the one before it.
 */
import { getRandomBytes } from 'expo-crypto';

/** Crockford base32: no I, L, O or U. */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;
const RANDOM_BYTES = 10;
/** 2^48 − 1: the largest timestamp a ULID can hold. */
const TIME_MAX = 281_474_976_710_655;
/** 2^80 − 1. */
const RANDOM_MAX = (BigInt(1) << BigInt(80)) - BigInt(1);

/** The contract's `ulid` rule. */
export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** `true` for a well-formed ULID. */
export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}

/** Returns `count` cryptographically secure random bytes. */
export type RandomBytes = (count: number) => Uint8Array;

/** The 48-bit timestamp as 10 characters (safe-integer arithmetic: 2^48 < 2^53). */
export function encodeTime(time: number): string {
  if (!Number.isSafeInteger(time) || time < 0 || time > TIME_MAX) {
    throw new RangeError(`A ULID timestamp must be an integer from 0 to ${TIME_MAX}, got ${String(time)}`);
  }
  let value = time;
  let text = '';
  for (let index = 0; index < TIME_LENGTH; index += 1) {
    const digit = value % 32;
    text = ENCODING[digit] + text;
    value = (value - digit) / 32;
  }
  return text;
}

/** The 80 random bits as 16 characters. */
function encodeRandom(random: bigint): string {
  let value = random;
  let text = '';
  for (let index = 0; index < RANDOM_LENGTH; index += 1) {
    text = ENCODING[Number(value & BigInt(31))] + text;
    value >>= BigInt(5);
  }
  return text;
}

function randomValue(randomBytes: RandomBytes): bigint {
  const bytes = randomBytes(RANDOM_BYTES);
  if (bytes.length !== RANDOM_BYTES) throw new Error('The random source returned the wrong number of bytes.');
  let value = BigInt(0);
  for (const byte of bytes) value = (value << BigInt(8)) | BigInt(byte);
  return value;
}

export type UlidFactoryOptions = {
  /** The clock (ms). Defaults to `Date.now`. */
  now?: () => number;
  /** The random source. Defaults to expo-crypto's secure `getRandomBytes`. */
  randomBytes?: RandomBytes;
};

/** A monotonic ULID generator (see the module notes). Tests inject a clock and a random source. */
export function createUlidFactory(options: UlidFactoryOptions = {}): () => string {
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? getRandomBytes;
  let lastTime = -1;
  let lastRandom = BigInt(0);

  return function nextUlid(): string {
    let time = Math.floor(now());
    if (time <= lastTime) {
      // Same millisecond, or the clock stepped back: stay on the last timestamp and count up.
      time = lastTime;
      lastRandom += BigInt(1);
      if (lastRandom > RANDOM_MAX) {
        // 2^80 ULIDs in one millisecond can't happen in practice; move on a millisecond to stay ordered.
        time = lastTime + 1;
        lastRandom = randomValue(randomBytes);
      }
    } else {
      lastRandom = randomValue(randomBytes);
    }
    const text = encodeTime(time) + encodeRandom(lastRandom);
    lastTime = time;
    return text;
  };
}

/** A new ULID for a transactional action (one per sale, per stock adjustment, …). */
export const ulid = createUlidFactory();
