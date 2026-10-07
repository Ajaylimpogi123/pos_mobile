/**
 * SC/PWD pricing (docs/api-contract.md → Senior Citizen / PWD Discount →
 * Pricing, steps A–E), against worked examples D, E and F line by line, plus
 * examples A and B unchanged; and the refund VAT split with SC/PWD
 * (`τ_i = line_total_i − X_i`).
 */
import { priceSale, type PricingLine, type PricingScPwd } from '@/sale/pricing';
import { priceRefund, refundTaxableAmount, taxablePartCents } from '@/sale/refunds';
import type { OrderItem } from '@/services/types';

function line(unit: number, qty: number, vatable = true, scPwd = false): PricingLine {
  return { unit_price_cents: unit, qty, is_vatable: vatable, discount: null, sc_pwd: scPwd };
}

const ONE_SENIOR_ITEMS = (vatExempt: boolean): PricingScPwd => ({ mode: 'items', persons: 1, diners: null, vat_exempt: vatExempt });

/** Example D's cart: Meal ₱250 (marked), Iced Tea ₱45 (marked), Meal ₱250. */
const EXAMPLE_D_LINES = [line(25000, 1, true, true), line(4500, 1, true, true), line(25000, 1)];

/** Example E's cart: Platter ₱800, Soda ₱120 × 2, Rice cake ₱60 (not VAT-able). */
const EXAMPLE_E_LINES = [line(80000, 1), line(24000 / 2, 2), line(6000, 1, false)];

function lineFigures(result: ReturnType<typeof priceSale>) {
  return result.lines.map((priced) => ({
    gross: priced.gross_cents,
    E: priced.sc_pwd_eligible_cents,
    R: priced.sc_pwd_vat_relief_cents,
    S: priced.sc_pwd_discount_cents,
    total: priced.line_total_cents,
    sc_pwd: priced.sc_pwd,
  }));
}

describe('worked example D (items mode, one senior, VAT exempt)', () => {
  const result = priceSale(EXAMPLE_D_LINES, null, ONE_SENIOR_ITEMS(true));

  it('prices each line: E, R_i, S_i and the line total', () => {
    expect(lineFigures(result)).toEqual([
      { gross: 25000, E: 25000, R: 2679, S: 4464, total: 17857, sc_pwd: true },
      { gross: 4500, E: 4500, R: 482, S: 804, total: 3214, sc_pwd: true },
      { gross: 25000, E: 0, R: 0, S: 0, total: 25000, sc_pwd: false },
    ]);
  });

  it('R = 3161, S = 5268; subtotal 54500 · discount 8429 · total 46071; VAT 22321 / 2679 / 21071', () => {
    expect(result).toMatchObject({
      subtotal_cents: 54500,
      line_discounts_cents: 0,
      order_discount_cents: 0,
      regular_discount_cents: 0,
      sc_pwd_vat_relief_cents: 3161,
      sc_pwd_discount_cents: 5268,
      discount_cents: 8429,
      total_cents: 46071,
      vatable_sales_cents: 22321,
      vat_amount_cents: 2679,
      vat_exempt_sales_cents: 21071,
      scPwdInvalid: false,
      valid: true,
    });
    // The senior pays ₱210.71 (= ₱295 ÷ 1.12 × 0.8).
    expect(result.lines[0].line_total_cents + result.lines[1].line_total_cents).toBe(21071);
  });
});

describe('worked example F (example D with VAT exempt unticked)', () => {
  const result = priceSale(EXAMPLE_D_LINES, null, ONE_SENIOR_ITEMS(false));

  it('no VAT relief: S = 5900 shared 5000 / 900 by E; line totals 20000 · 3600 · 25000', () => {
    expect(lineFigures(result)).toEqual([
      { gross: 25000, E: 25000, R: 0, S: 5000, total: 20000, sc_pwd: true },
      { gross: 4500, E: 4500, R: 0, S: 900, total: 3600, sc_pwd: true },
      { gross: 25000, E: 0, R: 0, S: 0, total: 25000, sc_pwd: false },
    ]);
  });

  it('subtotal 54500 · discount 5900 · total 48600; everything stays VAT-able: 43393 / 5207 / 0', () => {
    expect(result).toMatchObject({
      sc_pwd_vat_relief_cents: 0,
      sc_pwd_discount_cents: 5900,
      discount_cents: 5900,
      total_cents: 48600,
      vatable_sales_cents: 43393,
      vat_amount_cents: 5207,
      vat_exempt_sales_cents: 0,
      valid: true,
    });
    // The senior pays ₱236.00 (= ₱295 × 0.8).
    expect(result.lines[0].line_total_cents + result.lines[1].line_total_cents).toBe(23600);
  });
});

describe('worked example E (headcount mode, 4 diners, 1 senior, VAT exempt)', () => {
  const result = priceSale(EXAMPLE_E_LINES, null, { mode: 'headcount', persons: 1, diners: 4, vat_exempt: true });

  it('E_total = 27500 shared by gross; R and S by line (a non-VAT-able line gets no R)', () => {
    expect(lineFigures(result)).toEqual([
      { gross: 80000, E: 20000, R: 2143, S: 3572, total: 74285, sc_pwd: true },
      { gross: 24000, E: 6000, R: 643, S: 1071, total: 22286, sc_pwd: true },
      { gross: 6000, E: 1500, R: 0, S: 300, total: 5700, sc_pwd: true },
    ]);
  });

  it('R = 2786, S = 4943; subtotal 110000 · discount 7729 · total 102271; VAT 69643 / 8357 / 24271', () => {
    expect(result).toMatchObject({
      subtotal_cents: 110000,
      sc_pwd_vat_relief_cents: 2786,
      sc_pwd_discount_cents: 4943,
      discount_cents: 7729,
      total_cents: 102271,
      vatable_sales_cents: 69643,
      vat_amount_cents: 8357,
      vat_exempt_sales_cents: 24271,
      valid: true,
    });
  });

  it('marks in headcount mode are ignored (every line with a share is SC/PWD)', () => {
    const marked = priceSale(
      EXAMPLE_E_LINES.map((entry, index) => ({ ...entry, sc_pwd: index === 0 })),
      null,
      { mode: 'headcount', persons: 1, diners: 4, vat_exempt: true },
    );
    expect(marked.total_cents).toBe(102271);
  });
});

describe('examples A and B are unchanged (no SC/PWD)', () => {
  it('example A', () => {
    expect(priceSale([line(5000, 2), line(3500, 1)], null)).toMatchObject({
      subtotal_cents: 13500,
      discount_cents: 0,
      regular_discount_cents: 0,
      sc_pwd_vat_relief_cents: 0,
      sc_pwd_discount_cents: 0,
      total_cents: 13500,
      vatable_sales_cents: 12054,
      vat_amount_cents: 1446,
      vat_exempt_sales_cents: 0,
    });
  });

  it('example B', () => {
    const result = priceSale(
      [
        { unit_price_cents: 8000, qty: 1, is_vatable: true, discount: { kind: 'percent', value: 1000 } },
        line(4500, 2, false),
        line(3500, 3),
      ],
      { kind: 'amount', value: 1000 },
    );
    expect(result).toMatchObject({
      subtotal_cents: 27500,
      line_discounts_cents: 800,
      regular_discount_cents: 1800,
      discount_cents: 1800,
      total_cents: 25700,
      vatable_sales_cents: 15212,
      vat_amount_cents: 1825,
      vat_exempt_sales_cents: 8663,
    });
    expect(result.lines.map((priced) => priced.line_total_cents)).toEqual([6930, 8663, 10107]);
    expect(result.lines.every((priced) => !priced.sc_pwd && priced.sc_pwd_eligible_cents === 0)).toBe(true);
  });
});

describe('SC/PWD rules the server answers 422 for', () => {
  it('items mode with no marked line is invalid', () => {
    const result = priceSale([line(25000, 1)], null, ONE_SENIOR_ITEMS(true));
    expect(result).toMatchObject({ scPwdInvalid: true, valid: false, sc_pwd_discount_cents: 0, total_cents: 25000 });
  });

  it('another discount on a marked line, or an order discount, is invalid (no double discount)', () => {
    const onLine = priceSale(
      [{ ...line(25000, 1, true, true), discount: { kind: 'percent', value: 1000 } }],
      null,
      ONE_SENIOR_ITEMS(false),
    );
    expect(onLine.scPwdInvalid).toBe(true);
    expect(onLine.lines[0].line_total_cents).toBeGreaterThanOrEqual(0);
    const onOrder = priceSale(EXAMPLE_D_LINES, { kind: 'amount', value: 100 }, ONE_SENIOR_ITEMS(false));
    expect(onOrder.scPwdInvalid).toBe(true);
    // A discount on an unmarked line is fine in items mode.
    const unmarked = priceSale(
      [line(25000, 1, true, true), { ...line(25000, 1), discount: { kind: 'percent', value: 1000 } }],
      null,
      ONE_SENIOR_ITEMS(false),
    );
    expect(unmarked).toMatchObject({ scPwdInvalid: false, regular_discount_cents: 2500, sc_pwd_discount_cents: 5000, discount_cents: 7500 });
  });

  it('headcount with fewer diners than persons is invalid (and E never exceeds the bill)', () => {
    const result = priceSale(EXAMPLE_E_LINES, null, { mode: 'headcount', persons: 2, diners: 1, vat_exempt: false });
    expect(result.scPwdInvalid).toBe(true);
    expect(result.lines.reduce((sum, priced) => sum + priced.sc_pwd_eligible_cents, 0)).toBe(110000);
  });
});

function item(overrides: Partial<OrderItem> & { id: number }): OrderItem {
  return {
    product_id: overrides.id,
    product_name: `Item ${overrides.id}`,
    category_id: 1,
    category_name: 'Meals',
    sku: null,
    qty: 1,
    unit_price_cents: 0,
    gross_cents: 0,
    is_vatable: true,
    discount: null,
    line_discount_cents: 0,
    order_discount_share_cents: 0,
    line_total_cents: 0,
    notes: null,
    refunded_qty: 0,
    refunded_cents: 0,
    sc_pwd: false,
    sc_pwd_eligible_cents: 0,
    sc_pwd_vat_relief_cents: 0,
    sc_pwd_discount_cents: 0,
    ...overrides,
  };
}

/** Example D's order lines (as the server returns them). */
const D_ITEMS = [
  item({ id: 1, gross_cents: 25000, line_total_cents: 17857, sc_pwd: true, sc_pwd_eligible_cents: 25000, sc_pwd_vat_relief_cents: 2679, sc_pwd_discount_cents: 4464 }),
  item({ id: 2, gross_cents: 4500, line_total_cents: 3214, sc_pwd: true, sc_pwd_eligible_cents: 4500, sc_pwd_vat_relief_cents: 482, sc_pwd_discount_cents: 804 }),
  item({ id: 3, gross_cents: 25000, line_total_cents: 25000 }),
];

/** Example E's lines. */
const E_ITEMS = [
  item({ id: 11, gross_cents: 80000, line_total_cents: 74285, sc_pwd: true, sc_pwd_eligible_cents: 20000, sc_pwd_vat_relief_cents: 2143, sc_pwd_discount_cents: 3572 }),
  item({ id: 12, qty: 2, gross_cents: 24000, line_total_cents: 22286, sc_pwd: true, sc_pwd_eligible_cents: 6000, sc_pwd_vat_relief_cents: 643, sc_pwd_discount_cents: 1071 }),
  item({ id: 13, gross_cents: 6000, is_vatable: false, line_total_cents: 5700, sc_pwd: true, sc_pwd_eligible_cents: 1500, sc_pwd_discount_cents: 300 }),
];

describe('refund VAT split with SC/PWD (τ = line_total − X)', () => {
  it('τ: X = E − R − S only when the sale was VAT exempt', () => {
    expect(taxablePartCents(D_ITEMS[0], true)).toBe(0);
    expect(taxablePartCents(D_ITEMS[0], false)).toBe(17857);
    expect(taxablePartCents(E_ITEMS[0], true)).toBe(60000);
    // A line stored before SC/PWD (no such fields) is fully taxable.
    expect(taxablePartCents({ line_total_cents: 6930 }, true)).toBe(6930);
  });

  it('example D: the senior\'s meal is refunded VAT-exempt; the other meal is VAT-able', () => {
    expect(priceRefund(D_ITEMS, { 1: 1 }, true)).toMatchObject({
      amount_cents: 17857,
      vatable_sales_cents: 0,
      vat_amount_cents: 0,
      vat_exempt_sales_cents: 17857,
    });
    expect(priceRefund(D_ITEMS, { 1: 1, 3: 1 }, true)).toMatchObject({
      amount_cents: 42857,
      vatable_sales_cents: 22321,
      vat_amount_cents: 2679,
      vat_exempt_sales_cents: 17857,
    });
  });

  it('example F (not VAT exempt): the discounted line stays VAT-able', () => {
    const fItems = [item({ ...D_ITEMS[0], line_total_cents: 20000, sc_pwd_vat_relief_cents: 0, sc_pwd_discount_cents: 5000 })];
    expect(priceRefund(fItems, { 1: 1 }, false)).toMatchObject({
      amount_cents: 20000,
      vatable_sales_cents: 17857,
      vat_amount_cents: 2143,
      vat_exempt_sales_cents: 0,
    });
  });

  it('example E: the platter\'s taxable part is 60000 of 74285; the soda is refunded unit by unit, cumulatively', () => {
    expect(priceRefund(E_ITEMS, { 11: 1 }, true)).toMatchObject({
      amount_cents: 74285,
      vatable_sales_cents: 53571,
      vat_amount_cents: 6429,
      vat_exempt_sales_cents: 14285,
    });
    // Soda: T = 22286, τ = 22286 − 4286 = 18000, n = 2: the first unit is rhu(22286, 2) = 11143, τ part rhu(18000, 2) = 9000.
    const first = priceRefund(E_ITEMS, { 12: 1 }, true);
    expect(first).toMatchObject({ amount_cents: 11143, vatable_sales_cents: 8036, vat_amount_cents: 964, vat_exempt_sales_cents: 2143 });
    const rest = priceRefund(E_ITEMS.map((entry) => (entry.id === 12 ? { ...entry, refunded_qty: 1 } : entry)), { 12: 1 }, true);
    expect(first.amount_cents + rest.amount_cents).toBe(22286);
    // The rice cake isn't VAT-able: all of it is VAT-exempt.
    expect(priceRefund(E_ITEMS, { 13: 1 }, true)).toMatchObject({ amount_cents: 5700, vatable_sales_cents: 0, vat_exempt_sales_cents: 5700 });
  });

  it('Q-024 item 1: the taxable part is clamped to the line\'s refund amount (T = 2, τ = 1, n = 3, the 2nd unit)', () => {
    // amount = rhu(2 × 2, 3) − rhu(2 × 1, 3) = 1 − 1 = 0; unclamped taxable = rhu(1 × 2, 3) − rhu(1 × 1, 3) = 1 − 0 = 1.
    expect(refundTaxableAmount(0, 1, 3, 1, 1)).toBe(0);
    const tiny = item({ id: 9, qty: 3, line_total_cents: 2, sc_pwd: true, sc_pwd_eligible_cents: 1 });
    expect(taxablePartCents(tiny, true)).toBe(1);
    expect(priceRefund([{ ...tiny, refunded_qty: 1 }], { 9: 1 }, true)).toMatchObject({
      amount_cents: 0,
      vatable_sales_cents: 0,
      vat_amount_cents: 0,
      // Never −1.
      vat_exempt_sales_cents: 0,
    });
  });

  it('the clamp doesn\'t bite when the taxable part is below the amount', () => {
    // Example E's platter: amount 74285, taxable 60000.
    expect(refundTaxableAmount(74285, 60000, 1, 0, 1)).toBe(60000);
    // The 1st unit of the tiny line: amount rhu(2, 3) = 1, taxable rhu(1, 3) = 0.
    expect(refundTaxableAmount(1, 1, 3, 0, 1)).toBe(0);
    // Taxable equal to the amount (no SC/PWD): unchanged.
    expect(refundTaxableAmount(3369, 10107, 3, 0, 1)).toBe(3369);
  });

  it('without SC/PWD it is the Phase 7 split (worked example C)', () => {
    const c = [item({ id: 103, qty: 3, line_total_cents: 10107 })];
    expect(priceRefund(c, { 103: 1 })).toMatchObject({ amount_cents: 3369, vatable_sales_cents: 3008, vat_amount_cents: 361, vat_exempt_sales_cents: 0 });
  });
});
