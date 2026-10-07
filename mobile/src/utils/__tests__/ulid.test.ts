import { getRandomBytes } from 'expo-crypto';

import { createUlidFactory, encodeTime, isUlid, ulid, ULID_PATTERN } from '@/utils/ulid';

const randomBytesMock = getRandomBytes as jest.Mock;

/** A fixed random source: 10 bytes of `value`. */
function constantBytes(value: number) {
  return (count: number) => new Uint8Array(count).fill(value);
}

describe('ULID format', () => {
  it('is 26 uppercase Crockford base32 characters matching the contract rule', () => {
    for (let index = 0; index < 200; index += 1) {
      const value = ulid();
      expect(value).toHaveLength(26);
      expect(value).toMatch(ULID_PATTERN);
      expect(value).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
      expect(value).not.toMatch(/[ILOU]/);
    }
  });

  it('encodes the 48-bit millisecond timestamp in the first 10 characters', () => {
    expect(encodeTime(0)).toBe('0000000000');
    // The ULID spec's examples: ulid(1469918176385) → "01ARYZ6S41…", decodeTime("01ARZ3NDEK…") → 1469922850259.
    expect(encodeTime(1469918176385)).toBe('01ARYZ6S41');
    expect(encodeTime(1469922850259)).toBe('01ARZ3NDEK');
    expect(encodeTime(281474976710655)).toBe('7ZZZZZZZZZ');
    expect(() => encodeTime(281474976710656)).toThrow(RangeError);
    expect(() => encodeTime(-1)).toThrow(RangeError);
    expect(() => encodeTime(1.5)).toThrow(RangeError);

    const make = createUlidFactory({ now: () => 1469918176385, randomBytes: constantBytes(0) });
    expect(make()).toBe('01ARYZ6S410000000000000000');
  });

  it('encodes the 80 random bits in the last 16 characters', () => {
    const make = createUlidFactory({ now: () => 0, randomBytes: constantBytes(0xff) });
    expect(make()).toBe('0000000000ZZZZZZZZZZZZZZZZ');
  });

  it('isUlid accepts well-formed ULIDs only', () => {
    expect(isUlid('01K62Z3K5Q9V7X2M4N6P8R0T1W')).toBe(true);
    expect(isUlid('01k62z3k5q9v7x2m4n6p8r0t1w')).toBe(false);
    expect(isUlid('81K62Z3K5Q9V7X2M4N6P8R0T1W')).toBe(false);
    expect(isUlid('01K62Z3K5Q9V7X2M4N6P8R0T1')).toBe(false);
    expect(isUlid('01K62Z3K5Q9V7X2M4N6P8R0T1U')).toBe(false);
  });
});

describe('randomness', () => {
  it('draws 10 bytes from the secure source (expo-crypto) for each new millisecond', () => {
    randomBytesMock.mockClear();
    const make = createUlidFactory({ now: (() => {
      let time = 1_000;
      return () => (time += 1);
    })() });
    make();
    make();
    expect(randomBytesMock).toHaveBeenCalledTimes(2);
    expect(randomBytesMock).toHaveBeenCalledWith(10);
  });

  it('is unique across many ULIDs', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 10_000; index += 1) seen.add(ulid());
    expect(seen.size).toBe(10_000);
  });
});

describe('time ordering', () => {
  it('sorts later ULIDs after earlier ones', () => {
    let time = 1_700_000_000_000;
    const make = createUlidFactory({ now: () => time });
    const values: string[] = [];
    for (let index = 0; index < 50; index += 1) {
      time += 7;
      values.push(make());
    }
    expect([...values].sort()).toEqual(values);
  });

  it('is monotonic within one millisecond: the random part counts up', () => {
    const make = createUlidFactory({ now: () => 1_700_000_000_000, randomBytes: constantBytes(0) });
    const first = make();
    const second = make();
    const third = make();
    expect(first.slice(0, 10)).toBe(second.slice(0, 10));
    expect(second.endsWith('0000000000000001')).toBe(true);
    expect(third.endsWith('0000000000000002')).toBe(true);
    expect([third, first, second].sort()).toEqual([first, second, third]);
  });

  it('stays ordered when the clock steps back', () => {
    let time = 1_700_000_000_500;
    const make = createUlidFactory({ now: () => time });
    const before = make();
    time -= 400;
    const after = make();
    expect(after > before).toBe(true);
    expect(after.slice(0, 10)).toBe(before.slice(0, 10));
  });
});
