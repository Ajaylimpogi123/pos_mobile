/**
 * Exact decimal quantities (Ingredients, Recipes & Purchasing §A).
 *
 * Ingredient quantities, unit factors and `avg_cost` arrive as decimal
 * strings. They are never parsed into floats: every value becomes a scaled
 * `BigInt` (digits + a decimal scale), and rounding is `round_half_up` (half
 * away from zero, as the server's bcmath / brick/math `HALF_UP`). The server
 * stays the authority; these helpers only build previews and display text.
 */
import type { DecimalValue } from './contract/types';

/** Stored quantities keep 3 decimals (`DECIMAL(15,3)`). */
export const QTY_SCALE = 3;

/** §A: a quantity is at most 1,000,000 (in the entered unit). */
export const QTY_MAX_WHOLE = 1_000_000n;

/** §A: an ingredient unit's factor: > 0, at most 1,000,000, at most 10 decimals. */
export const FACTOR_MAX_DECIMALS = 10;
export const FACTOR_MAX_WHOLE = 1_000_000n;

/** A decimal as its digits and scale: `"28.349523125"` → `{ digits: 28349523125n, scale: 9 }`. */
export type DecimalParts = { digits: bigint; scale: number };

const DECIMAL_TEXT = /^([+-]?)(\d*)(?:\.(\d*))?$/;

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/** Exact parts of a decimal string (or a plain number, read through `String()`); `null` when it isn't one. */
export function decimalParts(value: DecimalValue): DecimalParts | null {
  const text = String(value).trim();
  const match = DECIMAL_TEXT.exec(text);
  if (!match) return null;
  const [, sign, whole = '', fraction = ''] = match;
  if (whole === '' && fraction === '') return null;
  const digits = BigInt(`${whole === '' ? '0' : whole}${fraction}`);
  return { digits: sign === '-' ? -digits : digits, scale: fraction.length };
}

/** `n / d` (`d > 0`) rounded half away from zero (`round_half_up`). */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = (absolute * 2n + denominator) / (denominator * 2n);
  return negative ? -quotient : quotient;
}

/** The value at `scale` decimals (`round_half_up` when it has more). */
export function rescale(parts: DecimalParts, scale: number): bigint {
  if (parts.scale === scale) return parts.digits;
  if (parts.scale < scale) return parts.digits * pow10(scale - parts.scale);
  return divRoundHalfUp(parts.digits, pow10(parts.scale - scale));
}

/** A decimal as a `BigInt` scaled by `10^scale`, or `null` when it isn't a decimal. */
export function toScaled(value: DecimalValue, scale: number = QTY_SCALE): bigint | null {
  const parts = decimalParts(value);
  return parts ? rescale(parts, scale) : null;
}

/** A scaled `BigInt` as a fixed decimal string: `(50000000n, 3)` → `"50000.000"`. */
export function formatFixed(scaled: bigint, scale: number = QTY_SCALE): string {
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? '-' : ''}${whole}${scale > 0 ? `.${fraction}` : ''}`;
}

/** A fixed decimal without trailing zeros: `"50000.000"` → `"50000"`, `"1.500"` → `"1.5"`. */
function trimZeros(fixed: string): string {
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/\.?0+$/, '');
}

/**
 * §A conversion: `base_qty = round_half_up(qty × factor, 3)`, as the server's
 * 3-decimal string (`"226.796"`), or `null` when either input isn't a decimal.
 */
export function toBaseQty(qty: DecimalValue, factor: DecimalValue): string | null {
  const q = decimalParts(qty);
  const f = decimalParts(factor);
  if (!q || !f) return null;
  const product: DecimalParts = { digits: q.digits * f.digits, scale: q.scale + f.scale };
  return formatFixed(rescale(product, QTY_SCALE), QTY_SCALE);
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A scaled quantity for display: grouped, trailing zeros dropped (`25000000n` → `"25,000"`). */
export function formatScaledQty(scaled: bigint, scale: number = QTY_SCALE): string {
  const text = trimZeros(formatFixed(scaled, scale));
  const negative = text.startsWith('-');
  const [whole, fraction] = (negative ? text.slice(1) : text).split('.');
  return `${negative ? '-' : ''}${groupThousands(whole ?? '0')}${fraction ? `.${fraction}` : ''}`;
}

/** A quantity for display: `"25000.000"` → `"25,000"`, `"226.796"` → `"226.796"`. Unreadable input is shown as is. */
export function formatQty(value: DecimalValue): string {
  const scaled = toScaled(value);
  return scaled === null ? String(value) : formatScaledQty(scaled);
}

/** `"25,000 g"`. */
export function formatQtyUnit(value: DecimalValue, unit: string): string {
  return `${formatQty(value)} ${unit}`;
}

/** The friendlier, larger unit of a base unit (1 kg = 1,000 g; 1 L = 1,000 mL). */
const LARGER_UNIT: Readonly<Record<string, { unit: string; per: bigint }>> = {
  g: { unit: 'kg', per: 1000n },
  mL: { unit: 'L', per: 1000n },
};

/**
 * The same base quantity in a larger unit when it helps (at least 1,000 base
 * units): `("25000.000", "g")` → `"25 kg"`; `null` otherwise.
 */
export function friendlyQty(value: DecimalValue, baseUnit: string): string | null {
  const larger = LARGER_UNIT[baseUnit];
  const scaled = toScaled(value);
  if (!larger || scaled === null) return null;
  const absolute = scaled < 0n ? -scaled : scaled;
  if (absolute < larger.per * pow10(QTY_SCALE)) return null;
  return `${formatScaledQty(divRoundHalfUp(scaled, larger.per))} ${larger.unit}`;
}

/** `"25,000 g (25 kg)"`, or `"750 g"` when no larger unit helps. */
export function formatBaseQty(value: DecimalValue, baseUnit: string): string {
  const friendly = friendlyQty(value, baseUnit);
  const main = formatQtyUnit(value, baseUnit);
  return friendly ? `${main} (${friendly})` : main;
}

/** Compares two quantities exactly (at 3 decimals): -1, 0 or 1. Unreadable values count as 0. */
export function compareQty(a: DecimalValue, b: DecimalValue): -1 | 0 | 1 {
  const left = toScaled(a) ?? 0n;
  const right = toScaled(b) ?? 0n;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** `a + b` as a 3-decimal string. */
export function addQty(a: DecimalValue, b: DecimalValue): string {
  return formatFixed((toScaled(a) ?? 0n) + (toScaled(b) ?? 0n));
}

/** Q-027 / Q-030: product quantities are whole numbers (products count in `pc`). */
export const PRODUCT_WHOLE_MESSAGE = 'A product quantity must be a whole number.';

/** `true` when the quantity has no fractional part (`"24"`, `24`, `"24.000"`). */
export function isWholeQty(value: DecimalValue): boolean {
  const scaled = toScaled(value);
  return scaled !== null && scaled % 10n ** BigInt(QTY_SCALE) === 0n;
}

/** `true` when the quantity is ≤ 0. */
export function isQtyAtOrBelowZero(value: DecimalValue): boolean {
  return (toScaled(value) ?? 0n) <= 0n;
}

/** §G line total: `round_half_up(unit_price_cents × qty, 0)` (integer centavos), or `null` for an unreadable qty. */
export function lineTotalCents(unitPriceCents: number, qty: DecimalValue): number | null {
  const parts = decimalParts(qty);
  if (!parts || !Number.isSafeInteger(unitPriceCents)) return null;
  const cents = divRoundHalfUp(BigInt(unitPriceCents) * parts.digits, pow10(parts.scale));
  return Number(cents);
}

/**
 * The cost of `units` base units at `avg_cost` (centavos per base unit, 6
 * decimals), rounded half up to whole centavos: `("4.666667", 1000n)` → 4667.
 */
export function costForBaseUnits(avgCost: DecimalValue, units: bigint): number | null {
  const parts = decimalParts(avgCost);
  if (!parts) return null;
  return Number(divRoundHalfUp(parts.digits * units, pow10(parts.scale)));
}

/** `avg_cost` keeps 6 decimals (centavos per base unit, `DECIMAL(20,6)`). */
export const AVG_COST_SCALE = 6;

/**
 * §D1: the cost per base unit from the price of one unit,
 * `new_avg = round_half_up(cost_cents / factor, 6)`, as the server's 6-decimal
 * string (`(125000, "25000")` → `"5.000000"`), or `null` when the factor isn't
 * a positive decimal or the cost isn't a whole number of centavos.
 */
export function costPerBaseUnit(costCents: number, factor: DecimalValue): string | null {
  const f = decimalParts(factor);
  if (!f || f.digits <= 0n || !Number.isSafeInteger(costCents)) return null;
  // cost / (digits / 10^scale) at 6 decimals = cost × 10^(scale + 6) / digits.
  const scaled = divRoundHalfUp(BigInt(costCents) * pow10(f.scale + AVG_COST_SCALE), f.digits);
  return formatFixed(scaled, AVG_COST_SCALE);
}

/**
 * The stock value at a cost (§B): `round_half_up(max(qty, 0) × avg_cost, 0)`
 * in integer centavos, or `null` for unreadable input.
 */
export function stockValueCents(qty: DecimalValue, avgCost: DecimalValue): number | null {
  const q = decimalParts(qty);
  const cost = decimalParts(avgCost);
  if (!q || !cost) return null;
  const onHand = q.digits > 0n ? q.digits : 0n;
  return Number(divRoundHalfUp(onHand * cost.digits, pow10(q.scale + cost.scale)));
}

/**
 * A cost rate (centavos per base unit) in pesos for display, with 2 to 4
 * decimals, rounded half up: `"5.000000"` → `"₱0.05"`, `"4.666667"` →
 * `"₱0.0467"`, `"48"` → `"₱0.48"`. A rate below ₱0.0001 reads `< ₱0.0001`.
 */
export function formatCostRate(avgCost: DecimalValue): string | null {
  const parts = decimalParts(avgCost);
  if (!parts) return null;
  // Pesos = centavos / 100, so the scale grows by 2; show at most 4 decimals.
  const pesos = rescale({ digits: parts.digits, scale: parts.scale + 2 }, 4);
  if (pesos === 0n && parts.digits > 0n) return '< ₱0.0001';
  const negative = pesos < 0n;
  const fixed = formatFixed(negative ? -pesos : pesos, 4).replace(/0{1,2}$/, '');
  const [whole = '0', fraction = ''] = fixed.split('.');
  return `${negative ? '-' : ''}₱${groupThousands(whole)}.${fraction.padEnd(2, '0')}`;
}

/** The unit an average cost is shown per: 1 kg, 1 L, or 1 pc (in base units). */
export function costDisplayUnit(baseUnit: string): { unit: string; baseUnits: bigint } {
  const larger = LARGER_UNIT[baseUnit];
  return larger ? { unit: larger.unit, baseUnits: larger.per } : { unit: baseUnit, baseUnits: 1n };
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type QtyInputProblem = 'empty' | 'format' | 'decimals' | 'zero' | 'negative' | 'max';

export type QtyInputResult = { ok: true; value: string; scaled: bigint } | { ok: false; problem: QtyInputProblem };

type QtyInputOptions = {
  /** Corrections and adjustments may be negative (default `false`). */
  allowNegative?: boolean;
  /** Counts may be 0 (default `false`). */
  allowZero?: boolean;
  /** Decimal places allowed (default 3). */
  maxDecimals?: number;
  /** The largest absolute whole value (default 1,000,000). */
  maxWhole?: bigint;
};

/**
 * Checks a typed quantity against §A (at most 3 decimals, > 0 or ≠ 0 where
 * corrections are allowed, at most 1,000,000) and returns it as the canonical
 * decimal string to send (`"1.50"` → `"1.5"`, `"-0.2"`).
 */
export function parseQtyInput(text: string, options: QtyInputOptions = {}): QtyInputResult {
  const { allowNegative = false, allowZero = false, maxDecimals = QTY_SCALE, maxWhole = QTY_MAX_WHOLE } = options;
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, problem: 'empty' };
  const parts = decimalParts(trimmed);
  if (!parts || trimmed.startsWith('+')) return { ok: false, problem: 'format' };
  if (parts.scale > maxDecimals) return { ok: false, problem: 'decimals' };
  const scaled = rescale(parts, maxDecimals);
  if (scaled === 0n && !allowZero) return { ok: false, problem: 'zero' };
  if (scaled < 0n && !allowNegative) return { ok: false, problem: 'negative' };
  const absolute = scaled < 0n ? -scaled : scaled;
  if (absolute > maxWhole * pow10(maxDecimals)) return { ok: false, problem: 'max' };
  return { ok: true, value: trimZeros(formatFixed(scaled, maxDecimals)), scaled };
}

/** A friendly message for a quantity problem. */
export function qtyProblemMessage(problem: QtyInputProblem, options: { allowNegative?: boolean; allowZero?: boolean } = {}): string {
  switch (problem) {
    case 'empty':
      return 'Enter a quantity.';
    case 'decimals':
      return 'Use at most 3 decimals.';
    case 'zero':
      return options.allowNegative ? 'Enter a quantity other than 0.' : 'Enter a quantity greater than 0.';
    case 'negative':
      return options.allowZero ? 'Enter 0 or more.' : 'Enter a quantity greater than 0.';
    case 'max':
      return 'Enter at most 1,000,000.';
    default:
      return 'Enter a number, e.g. 2.5.';
  }
}

/** Checks a unit factor (> 0, at most 1,000,000, at most 10 decimals); returns the canonical string. */
export function parseFactorInput(text: string): QtyInputResult {
  return parseQtyInput(text, { maxDecimals: FACTOR_MAX_DECIMALS, maxWhole: FACTOR_MAX_WHOLE });
}
