/**
 * Sale pricing (docs/api-contract.md → Core Sale (Phase 3) → Sale pricing,
 * extended by Senior Citizen / PWD Discount → Pricing).
 *
 * The server prices every sale itself and is authoritative. The app runs the
 * **same** algorithm to show the cart and checkout totals, to send
 * `client_total_cents` (the checksum), and to build an offline sale, so the
 * two must agree to the centavo.
 *
 * Everything is integer centavos. Intermediate products (e.g. `D × net_i`,
 * `V × 10000`) can exceed 2^53, so the maths runs on `BigInt` and only the
 * results (always far below 2^53) become numbers again. No floats anywhere.
 *
 * 1. `gross = unit_price × qty`
 * 2. line discount: percent → `rhu(gross × bps, 10000)`, amount → `value` (must be ≤ gross)
 * 3. `net = gross − line discount`; `B = Σ net`
 * 4. order discount `D`: percent → `rhu(B × bps, 10000)`, amount → `value` (must be ≤ B)
 * 5. `D` is shared pro rata to `net` by the largest remainder; ties go to the lower line index
 * 6. `line_total = net − share`
 * 7. totals; `total = subtotal − discount = Σ line_total`
 * 8. VAT once per order: `V = Σ line_total` of vatable lines,
 *    `vatable_sales = rhu(V × 10000, 10000 + rate)`, `vat = V − vatable_sales`
 * 9. `subtotal ≤ 1000000000`
 *
 * SC/PWD (after steps 1–6; with SC/PWD, `D = 0` and eligible lines carry no
 * line discount, so for them `net = gross`):
 * A. eligible gross `E_i`: `items` → `gross_i` of marked lines; `headcount` →
 *    `E_total = rhu(subtotal × persons, diners)` shared pro rata to `gross_i`
 * B. VAT relief (only with `vat_exempt`): `EV` / `EX` = Σ `E_i` of VAT-able /
 *    non-VAT-able lines, `base = rhu(EV × 10000, 10000 + r)`, `R = EV − base`
 *    shared to the VAT-able lines pro rata to `E_i`. Without it: `base = EV`, `R = 0`.
 * C. `S = rhu((base + EX) × 2000, 10000)`, shared pro rata to `E_i − R_i`
 * D. `line_total = net − share − R_i − S_i`; `discount = line discounts + D + R + S`
 * E. VAT: the exempt part `X_i = E_i − R_i − S_i` (with `vat_exempt`, else 0),
 *    `T = Σ` over VAT-able lines of `line_total − X_i`, `vatable_sales =
 *    rhu(T × 10000, 10000 + r)`, `vat = T − vatable_sales`, `vat_exempt = total − T`
 *    (step 8 is the case with no SC/PWD).
 */
import type { DiscountKind, ScPwdMode } from '@/services/types';

/**
 * Philippine VAT, included in prices: the server's `config('pos.vat_rate_bps')`,
 * which the contract fixes at 1200 (12%).
 * Fixed for v1 (contract Q-003, resolved 2026-09-25): if the rate ever becomes
 * configurable, the contract adds `vat_rate_bps` to `AuthUser.branch`.
 */
export const VAT_RATE_BPS = 1200;

/** The SC/PWD rate: the server's `config('pos.sc_pwd_discount_bps')`, which the contract fixes at 2000 (20%). */
export const SC_PWD_RATE_BPS = 2000;

/** Contract size limit: `subtotal_cents ≤ 1000000000` (₱10,000,000). */
export const MAX_SUBTOTAL_CENTS = 1_000_000_000;

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const BPS = BigInt(10_000);

/** A discount as the pricing needs it (the `type` never changes an amount). */
export type PricingDiscount = {
  kind: DiscountKind;
  /** `percent`: basis points. `amount`: centavos. */
  value: number;
};

export type PricingLine = {
  unit_price_cents: number;
  qty: number;
  is_vatable: boolean;
  discount: PricingDiscount | null;
  /** SC/PWD `items` mode: the line is marked (ignored in `headcount` mode and without SC/PWD). */
  sc_pwd?: boolean;
};

/** The sale's SC/PWD as the pricing needs it (ID numbers never change an amount). */
export type PricingScPwd = {
  mode: ScPwdMode;
  /** The number of SC/PWD persons (`p`). */
  persons: number;
  /** `headcount`: the number of diners (`d`); ignored in `items` mode. */
  diners: number | null;
  vat_exempt: boolean;
};

export type PricedLine = {
  gross_cents: number;
  line_discount_cents: number;
  net_cents: number;
  order_discount_share_cents: number;
  line_total_cents: number;
  is_vatable: boolean;
  /** The line discount is more than the gross (the server answers 422); it is capped at the gross here. */
  discountExceedsGross: boolean;
  /** SC/PWD: marked (`items`), or given any share (`headcount`). */
  sc_pwd: boolean;
  /** `E_i`. */
  sc_pwd_eligible_cents: number;
  /** `R_i`. */
  sc_pwd_vat_relief_cents: number;
  /** `S_i`. */
  sc_pwd_discount_cents: number;
};

export type SalePricing = {
  lines: PricedLine[];
  subtotal_cents: number;
  line_discounts_cents: number;
  /** `B`: Σ net, the base of the order discount. */
  discount_base_cents: number;
  /** `D`: the order discount in centavos. */
  order_discount_cents: number;
  /**
   * The regular discounts: line discounts + D. The approval check (and the
   * offline `discount_over_limit` flag) uses only these; SC/PWD never needs approval.
   */
  regular_discount_cents: number;
  /** `R`: the VAT removed for SC/PWD (0 unless `vat_exempt`). */
  sc_pwd_vat_relief_cents: number;
  /** `S`: the SC/PWD discount. */
  sc_pwd_discount_cents: number;
  /** line discounts + D + R + S. */
  discount_cents: number;
  total_cents: number;
  vatable_sales_cents: number;
  vat_amount_cents: number;
  vat_exempt_sales_cents: number;
  /** The order discount is more than `B` (the server answers 422); it is capped at `B` here. */
  orderDiscountExceedsBase: boolean;
  /** `subtotal_cents` is over the size limit (422 on `items`). */
  tooLarge: boolean;
  /**
   * SC/PWD breaks one of its rules (another discount on an eligible line or
   * on the order, `items` mode with no line marked, diners below the persons
   * count, no person): the server answers 422. The amounts are still worked
   * out, never below 0.
   */
  scPwdInvalid: boolean;
  /** No pricing rule is broken (an empty sale counts as valid here). */
  valid: boolean;
};

/** Round half up, for `n ≥ 0` and `d > 0`: `floor((n + floor(d / 2)) / d)`. */
export function rhu(n: bigint, d: bigint): bigint {
  if (n < ZERO || d <= ZERO) throw new RangeError('rhu needs n ≥ 0 and d > 0.');
  // BigInt division truncates, which is floor for non-negative values.
  return (n + d / TWO) / d;
}

/** A non-negative safe integer as a BigInt; anything else is a programming error. */
function toBig(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer, got ${String(value)}`);
  }
  return BigInt(value);
}

function sum(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, ZERO);
}

function atLeastZero(value: bigint): bigint {
  return value < ZERO ? ZERO : value;
}

function discountAmount(base: bigint, discount: PricingDiscount | null, label: string): bigint {
  if (!discount) return ZERO;
  const value = toBig(discount.value, label);
  return discount.kind === 'percent' ? rhu(base * value, BPS) : value;
}

/**
 * Step 5 (and SC/PWD steps A–C): shares `d` across the lines pro rata to
 * `weights` by the largest remainder. `floor_i = floor(d × w_i / b)`,
 * `rem_i = (d × w_i) mod b`; the `d − Σ floor_i` leftover centavos go one
 * each to the largest remainders, ties to the lower index. With `b = 0`
 * every share is 0.
 */
export function allocateOrderDiscount(d: bigint, weights: readonly bigint[], b: bigint): bigint[] {
  if (b === ZERO || d === ZERO) return weights.map(() => ZERO);
  const shares = weights.map((weight) => (d * weight) / b);
  const remainders = weights.map((weight) => (d * weight) % b);
  let leftover = d - sum(shares);

  const byRemainder = weights
    .map((_weight, index) => index)
    .sort((left, right) => {
      if (remainders[left] === remainders[right]) return left - right;
      return remainders[right] > remainders[left] ? 1 : -1;
    });
  for (const index of byRemainder) {
    if (leftover <= ZERO) break;
    shares[index] += ONE;
    leftover -= ONE;
  }
  return shares;
}

/** The largest-remainder method under its SC/PWD name (steps A–C use step 5's method). */
export const allocateLargestRemainder = allocateOrderDiscount;

type ScPwdAmounts = {
  eligible: bigint[];
  relief: bigint[];
  discount: bigint[];
  exempt: bigint[];
  R: bigint;
  S: bigint;
  invalid: boolean;
};

/** SC/PWD steps A–C, and each line's exempt part `X_i` for step E. */
function scPwdAmounts(
  lines: readonly PricingLine[],
  gross: readonly bigint[],
  subtotal: bigint,
  scPwd: PricingScPwd,
  vatRate: bigint,
  scPwdRate: bigint,
): ScPwdAmounts {
  const persons = Math.max(0, Math.trunc(scPwd.persons));
  let invalid = persons < 1;

  // A. Eligible gross per line.
  let eligible: bigint[];
  if (scPwd.mode === 'items') {
    eligible = gross.map((value, index) => (lines[index].sc_pwd === true ? value : ZERO));
    if (!lines.some((line) => line.sc_pwd === true)) invalid = true;
  } else {
    const wanted = Math.trunc(scPwd.diners ?? 0);
    // Diners below the persons count (or none) break the rule: priced with d = p so E never exceeds the bill.
    const diners = Math.max(wanted, persons, 1);
    if (wanted < Math.max(persons, 1)) invalid = true;
    const total = rhu(subtotal * BigInt(persons), BigInt(diners));
    eligible = allocateLargestRemainder(total, gross, subtotal);
  }

  // B. VAT relief.
  const vatable = eligible.map((value, index) => (lines[index].is_vatable ? value : ZERO));
  const EV = sum(vatable);
  const EX = sum(eligible) - EV;
  let base = EV;
  let relief = eligible.map(() => ZERO);
  if (scPwd.vat_exempt) {
    base = rhu(EV * BPS, BPS + vatRate);
    relief = allocateLargestRemainder(EV - base, vatable, EV);
  }
  const R = EV - base;

  // C. The SC/PWD discount, shared pro rata to E_i − R_i (whose sum is base + EX).
  const S = rhu((base + EX) * scPwdRate, BPS);
  const afterRelief = eligible.map((value, index) => value - relief[index]);
  const discount = allocateLargestRemainder(S, afterRelief, base + EX);

  // E. The exempt part of each line (only when the eligible part is VAT-exempt).
  const exempt = eligible.map((value, index) => (scPwd.vat_exempt ? value - relief[index] - discount[index] : ZERO));

  return { eligible, relief, discount, exempt, R, S, invalid };
}

/**
 * Prices a sale exactly as the server does (see the module notes). `scPwd`
 * is the sale's SC/PWD (`null`: none); each line's `sc_pwd` marks it in
 * `items` mode.
 */
export function priceSale(
  lines: readonly PricingLine[],
  orderDiscount: PricingDiscount | null,
  scPwd: PricingScPwd | null = null,
  vatRateBps: number = VAT_RATE_BPS,
): SalePricing {
  const vatRate = toBig(vatRateBps, 'vatRateBps');
  const gross = lines.map((line, index) =>
    toBig(line.unit_price_cents, `lines[${index}].unit_price_cents`) * toBig(line.qty, `lines[${index}].qty`),
  );
  const wanted = lines.map((line, index) => discountAmount(gross[index], line.discount, `lines[${index}].discount.value`));
  const lineDiscounts = wanted.map((amount, index) => (amount > gross[index] ? gross[index] : amount));
  const nets = gross.map((value, index) => value - lineDiscounts[index]);
  const base = sum(nets);

  const wantedOrderDiscount = discountAmount(base, orderDiscount, 'discount.value');
  const orderDiscountCents = wantedOrderDiscount > base ? base : wantedOrderDiscount;
  const shares = allocateOrderDiscount(orderDiscountCents, nets, base);
  const subtotal = sum(gross);
  const lineDiscountsTotal = sum(lineDiscounts);

  const sc = scPwd ? scPwdAmounts(lines, gross, subtotal, scPwd, vatRate, toBig(SC_PWD_RATE_BPS, 'scPwdRateBps')) : null;
  // No double discount: an eligible line (or, with SC/PWD, the order) can't carry another discount.
  const conflict =
    sc !== null &&
    (orderDiscountCents > ZERO ||
      lines.some((line, index) => lineDiscounts[index] > ZERO && (scPwd?.mode === 'headcount' || line.sc_pwd === true)));

  const lineTotals = nets.map((net, index) =>
    atLeastZero(net - shares[index] - (sc ? sc.relief[index] + sc.discount[index] : ZERO)),
  );
  const total = sum(lineTotals);
  // T: the taxable amount (step E; step 8 when there is no SC/PWD).
  const taxable = atLeastZero(
    sum(lineTotals.map((value, index) => (lines[index].is_vatable ? atLeastZero(value - (sc ? sc.exempt[index] : ZERO)) : ZERO))),
  );
  const vatableSales = rhu(taxable * BPS, BPS + vatRate);
  const R = sc ? sc.R : ZERO;
  const S = sc ? sc.S : ZERO;

  const pricedLines: PricedLine[] = lines.map((line, index) => {
    const eligible = sc ? sc.eligible[index] : ZERO;
    return {
      gross_cents: Number(gross[index]),
      line_discount_cents: Number(lineDiscounts[index]),
      net_cents: Number(nets[index]),
      order_discount_share_cents: Number(shares[index]),
      line_total_cents: Number(lineTotals[index]),
      is_vatable: line.is_vatable,
      discountExceedsGross: wanted[index] > gross[index],
      sc_pwd: sc !== null && (scPwd?.mode === 'items' ? line.sc_pwd === true : eligible > ZERO),
      sc_pwd_eligible_cents: Number(eligible),
      sc_pwd_vat_relief_cents: Number(sc ? sc.relief[index] : ZERO),
      sc_pwd_discount_cents: Number(sc ? sc.discount[index] : ZERO),
    };
  });

  const orderDiscountExceedsBase = wantedOrderDiscount > base;
  const tooLarge = subtotal > BigInt(MAX_SUBTOTAL_CENTS);
  const scPwdInvalid = sc !== null && (sc.invalid || conflict);

  return {
    lines: pricedLines,
    subtotal_cents: Number(subtotal),
    line_discounts_cents: Number(lineDiscountsTotal),
    discount_base_cents: Number(base),
    order_discount_cents: Number(orderDiscountCents),
    regular_discount_cents: Number(lineDiscountsTotal + orderDiscountCents),
    sc_pwd_vat_relief_cents: Number(R),
    sc_pwd_discount_cents: Number(S),
    discount_cents: Number(subtotal - total),
    total_cents: Number(total),
    vatable_sales_cents: Number(vatableSales),
    vat_amount_cents: Number(taxable - vatableSales),
    vat_exempt_sales_cents: Number(total - taxable),
    orderDiscountExceedsBase,
    tooLarge,
    scPwdInvalid,
    valid:
      !tooLarge && !orderDiscountExceedsBase && !scPwdInvalid && pricedLines.every((line) => !line.discountExceedsGross),
  };
}
