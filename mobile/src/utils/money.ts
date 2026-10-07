/**
 * Money helpers. Every amount in the app is an integer number of centavos
 * (`_cents`), exactly as the API sends it. These helpers only convert between
 * centavos and text, and they never use floating-point arithmetic: parsing
 * works on the digit string, and formatting uses integer division/remainder.
 */

const PESO_SIGN = '₱';

/** Largest amount (in centavos) the parser accepts: keeps every result a safe integer. */
const MAX_PARSE_CENTS = Number.MAX_SAFE_INTEGER;

/** Groups an integer digit string with commas: "1250000" → "1,250,000". */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Splits integer centavos into a whole-peso digit string and a 2-digit centavo string. */
function splitCents(cents: number): { negative: boolean; pesos: string; centavos: string } {
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError(`Money must be an integer number of centavos, got ${String(cents)}`);
  }
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const pesos = Math.trunc(absolute / 100); // integer division of an integer: exact
  const centavos = absolute % 100;
  return { negative, pesos: String(pesos), centavos: String(centavos).padStart(2, '0') };
}

/**
 * Formats integer centavos for display: `125050` → `"₱1,250.50"`,
 * `5000` → `"₱50.00"`, `-150` → `"-₱1.50"`.
 */
export function formatPeso(cents: number): string {
  const { negative, pesos, centavos } = splitCents(cents);
  return `${negative ? '-' : ''}${PESO_SIGN}${groupThousands(pesos)}.${centavos}`;
}

/**
 * Formats integer centavos as a bare amount for printed receipts (no peso
 * sign): `125050` → `"1,250.50"`, `800` → `"8.00"`, `-800` → `"-8.00"`.
 * The documents print the server's amounts; this only formats them.
 */
export function formatAmount(cents: number): string {
  const { negative, pesos, centavos } = splitCents(cents);
  return `${negative ? '-' : ''}${groupThousands(pesos)}.${centavos}`;
}

/**
 * Integer centavos as editable input text, without the sign or grouping:
 * `125050` → `"1250.50"`, `5000` → `"50.00"`, `0` → `"0.00"`.
 */
export function centsToInputText(cents: number): string {
  const { negative, pesos, centavos } = splitCents(cents);
  return `${negative ? '-' : ''}${pesos}.${centavos}`;
}

/**
 * Whole pesos with correctly placed thousands commas ("1,250" or "1,250,000"),
 * or plain digits ("1250"), optionally followed by "." and at most 2 decimals.
 * The integer part may be omitted when there are decimals (".5").
 */
const PESO_INPUT = /^(?:(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{0,2}))?|\.(\d{1,2}))$/;

/**
 * Parses what a user typed into a ₱ field into integer centavos, or `null`
 * when it isn't a valid non-negative amount.
 *
 * Accepts: `"50"`, `"50."`, `"50.5"`, `"50.50"`, `"1,250.50"`, `"1250.5"`, `".5"`,
 * an optional leading `₱`, and surrounding spaces.
 * Rejects: empty input, more than 2 decimals, negatives, misplaced commas,
 * letters, exponents, and several dots.
 *
 * The digits are combined as strings and converted once, so there is no
 * floating-point step anywhere (`"0.29"` → `29`, never `28.999…`).
 */
export function parsePesoInput(text: string): number | null {
  let value = text.trim();
  if (value.startsWith(PESO_SIGN)) value = value.slice(PESO_SIGN.length).trim();
  if (value === '') return null;

  const match = PESO_INPUT.exec(value);
  if (!match) return null;

  const [, groupedOrPlain, decimals, decimalsOnly] = match;
  const wholeDigits = (groupedOrPlain ?? '0').replace(/,/g, '');
  const centavoDigits = (decimalsOnly ?? decimals ?? '').padEnd(2, '0');

  const digits = `${wholeDigits}${centavoDigits}`.replace(/^0+(?=\d)/, '');
  const cents = Number(digits);
  if (!Number.isSafeInteger(cents) || cents > MAX_PARSE_CENTS) return null;
  return cents;
}

/**
 * Whole pesos, compact, for a narrow chart axis: `1250000` (₱12,500.00) →
 * `"12.5k"`, `250000000` → `"2.5M"`, `50000` → `"500"`. Integer arithmetic
 * only (one decimal, truncated), no peso sign.
 */
export function formatCompactPesos(cents: number): string {
  const { negative, pesos } = splitCents(cents);
  const whole = Number(pesos);
  const sign = negative ? '-' : '';
  const scaled = (unit: number, suffix: string) => {
    const integer = Math.trunc(whole / unit);
    const tenth = Math.trunc((whole % unit) / (unit / 10));
    return `${sign}${integer}${tenth > 0 ? `.${tenth}` : ''}${suffix}`;
  };
  if (whole >= 1_000_000) return scaled(1_000_000, 'M');
  if (whole >= 1_000) return scaled(1_000, 'k');
  return `${sign}${whole}`;
}
