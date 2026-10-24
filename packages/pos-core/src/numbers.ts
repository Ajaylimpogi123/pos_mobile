/**
 * Number display helpers. Everything is integer arithmetic: the API sends
 * percentages as integer basis points (`5500` = 55.00%), and formatting never
 * goes through a float, so there is no rounding drift.
 */

/** Shown wherever a value is unknown (e.g. a margin with no cost data). */
export const NO_VALUE = '—';

/** "1,284": thousands separators, integers only. */
export function formatCount(value: number): string {
  const sign = value < 0 ? '-' : '';
  const digits = String(Math.abs(Math.trunc(value)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Basis points → a percentage string, rounded half away from zero:
 * `formatPercentBps(5500)` → "55.0%", `(3333)` → "33.3%", `(3335)` → "33.4%",
 * `(-1250)` → "-12.5%", `(3000, 0)` → "30%", `(1234, 2)` → "12.34%".
 * `decimals` is 0, 1 or 2 (a basis point is 0.01%, so 2 is exact).
 */
export function formatPercentBps(bps: number, decimals: 0 | 1 | 2 = 1): string {
  const whole = Math.trunc(bps);
  const negative = whole < 0;
  const abs = Math.abs(whole);
  // Units of 10^-decimals percent: 1 bp = 0.01%, so divide by 10^(2 - decimals), rounding half up.
  const divisor = decimals === 2 ? 1 : decimals === 1 ? 10 : 100;
  const units = Math.floor((abs + Math.floor(divisor / 2)) / divisor);
  const scale = decimals === 2 ? 100 : decimals === 1 ? 10 : 1;
  const integerPart = Math.floor(units / scale);
  const fraction = units % scale;
  const text = decimals === 0 ? String(integerPart) : `${integerPart}.${String(fraction).padStart(decimals, '0')}`;
  return `${negative && units > 0 ? '-' : ''}${text}%`;
}

/** `formatPercentBps`, or "—" for `null` (e.g. no product has cost data). */
export function formatPercentBpsOrDash(bps: number | null, decimals: 0 | 1 | 2 = 1): string {
  return bps === null ? NO_VALUE : formatPercentBps(bps, decimals);
}
