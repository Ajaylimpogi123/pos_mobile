import { formatCount, formatPercentBps, formatPercentBpsOrDash, NO_VALUE } from '@/utils/numbers';

describe('formatPercentBps', () => {
  it.each([
    [5500, '55.0%'],
    [3000, '30.0%'],
    [2000, '20.0%'],
    [0, '0.0%'],
    [10000, '100.0%'],
    [1, '0.0%'],
    [5, '0.1%'],
    [3333, '33.3%'],
    [3335, '33.4%'],
    [3349, '33.5%'],
    [9999, '100.0%'],
    [-1250, '-12.5%'],
    [-4, '0.0%'],
  ])('%i bps → %s', (bps, expected) => {
    expect(formatPercentBps(bps)).toBe(expected);
  });

  it('supports 0 and 2 decimals', () => {
    expect(formatPercentBps(3000, 0)).toBe('30%');
    expect(formatPercentBps(3050, 0)).toBe('31%');
    expect(formatPercentBps(1234, 2)).toBe('12.34%');
    expect(formatPercentBps(5, 2)).toBe('0.05%');
  });

  it('has no float drift where floats would (e.g. 0.1 + 0.2 style values)', () => {
    // 2915 bps: 29.15% → 29.2% (a float 29.15 would round down to 29.1).
    expect(formatPercentBps(2915)).toBe('29.2%');
    expect(formatPercentBps(1005)).toBe('10.1%');
  });

  it('shows a dash for null', () => {
    expect(formatPercentBpsOrDash(null)).toBe(NO_VALUE);
    expect(formatPercentBpsOrDash(5500)).toBe('55.0%');
  });
});

describe('formatCount', () => {
  it('adds thousands separators', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1284)).toBe('1,284');
    expect(formatCount(1234567)).toBe('1,234,567');
    expect(formatCount(-1500)).toBe('-1,500');
  });
});
