/**
 * Sale pricing (docs/api-contract.md → Core Sale → Sale pricing): the app
 * must agree with the server to the centavo, so both sides test the
 * contract's worked examples A and B.
 */
import { allocateOrderDiscount, MAX_SUBTOTAL_CENTS, priceSale, rhu, type PricingLine } from '@pos/core/sale/pricing';

function line(unit_price_cents: number, qty: number, is_vatable = true, discount: PricingLine['discount'] = null): PricingLine {
  return { unit_price_cents, qty, is_vatable, discount };
}

describe('rhu (round half up)', () => {
  it('rounds halves up and everything else to the nearest integer', () => {
    expect(rhu(BigInt(5), BigInt(10))).toBe(BigInt(1));
    expect(rhu(BigInt(4), BigInt(10))).toBe(BigInt(0));
    expect(rhu(BigInt(15), BigInt(10))).toBe(BigInt(2));
    expect(rhu(BigInt(0), BigInt(7))).toBe(BigInt(0));
    // Odd divisor: floor(d / 2) = 5 for d = 11.
    expect(rhu(BigInt(16), BigInt(11))).toBe(BigInt(1));
    expect(rhu(BigInt(17), BigInt(11))).toBe(BigInt(2));
  });

  it('rejects a negative numerator or a non-positive divisor', () => {
    expect(() => rhu(BigInt(-1), BigInt(10))).toThrow(RangeError);
    expect(() => rhu(BigInt(1), BigInt(0))).toThrow(RangeError);
  });
});

describe('worked example A (no discount)', () => {
  it('₱50.00 × 2 and ₱35.00 × 1, both vatable', () => {
    const result = priceSale([line(5000, 2), line(3500, 1)], null);

    expect(result).toMatchObject({
      subtotal_cents: 13500,
      line_discounts_cents: 0,
      order_discount_cents: 0,
      discount_cents: 0,
      total_cents: 13500,
      vatable_sales_cents: 12054,
      vat_amount_cents: 1446,
      vat_exempt_sales_cents: 0,
      valid: true,
    });
    expect(result.lines.map((priced) => priced.line_total_cents)).toEqual([10000, 3500]);
  });
});

describe('worked example B (line + order discounts, a VAT-exempt line)', () => {
  const lines = [
    line(8000, 1, true, { kind: 'percent', value: 1000 }),
    line(4500, 2, false),
    line(3500, 3, true),
  ];
  const result = priceSale(lines, { kind: 'amount', value: 1000 });

  it('prices every line exactly as the contract table', () => {
    expect(result.lines).toEqual([
      expect.objectContaining({ gross_cents: 8000, line_discount_cents: 800, net_cents: 7200, order_discount_share_cents: 270, line_total_cents: 6930 }),
      expect.objectContaining({ gross_cents: 9000, line_discount_cents: 0, net_cents: 9000, order_discount_share_cents: 337, line_total_cents: 8663 }),
      expect.objectContaining({ gross_cents: 10500, line_discount_cents: 0, net_cents: 10500, order_discount_share_cents: 393, line_total_cents: 10107 }),
    ]);
  });

  it('gives the totals and a single per-order VAT rounding', () => {
    expect(result).toMatchObject({
      subtotal_cents: 27500,
      line_discounts_cents: 800,
      discount_base_cents: 26700,
      order_discount_cents: 1000,
      discount_cents: 1800,
      total_cents: 25700,
      vatable_sales_cents: 15212,
      vat_amount_cents: 1825,
      vat_exempt_sales_cents: 8663,
      valid: true,
    });
    // total = Σ line totals, always.
    expect(result.lines.reduce((sum, priced) => sum + priced.line_total_cents, 0)).toBe(result.total_cents);
  });
});

describe('allocating the order discount (largest remainder)', () => {
  it('gives the leftover centavo to the largest remainder (example B)', () => {
    const shares = allocateOrderDiscount(BigInt(1000), [BigInt(7200), BigInt(9000), BigInt(10500)], BigInt(26700));
    expect(shares.map(Number)).toEqual([270, 337, 393]);
  });

  it('breaks ties in favour of the lower line index', () => {
    // 100 over three equal lines: 33 each, 1 left over, all remainders equal → line 0.
    expect(allocateOrderDiscount(BigInt(100), [BigInt(500), BigInt(500), BigInt(500)], BigInt(1500)).map(Number)).toEqual([34, 33, 33]);
    // 2 left over → lines 0 and 1.
    expect(allocateOrderDiscount(BigInt(101), [BigInt(500), BigInt(500), BigInt(500)], BigInt(1500)).map(Number)).toEqual([34, 34, 33]);
  });

  it('never gives a centavo to a line with a zero net, and shares 0 when B = 0', () => {
    expect(allocateOrderDiscount(BigInt(3), [BigInt(0), BigInt(5), BigInt(5)], BigInt(10)).map(Number)).toEqual([0, 2, 1]);
    expect(allocateOrderDiscount(BigInt(0), [BigInt(0), BigInt(0)], BigInt(0)).map(Number)).toEqual([0, 0]);
  });

  it('always shares exactly D', () => {
    const nets = [BigInt(333), BigInt(1), BigInt(9999), BigInt(12345), BigInt(7)];
    const base = nets.reduce((sum, net) => sum + net, BigInt(0));
    for (const d of [1, 2, 17, 999, 12345, 22685]) {
      const shares = allocateOrderDiscount(BigInt(d), nets, base);
      expect(shares.reduce((sum, share) => sum + share, BigInt(0))).toBe(BigInt(d));
      shares.forEach((share, index) => expect(share <= nets[index]).toBe(true));
    }
  });
});

describe('edge cases', () => {
  it('rounds a percent line discount half up', () => {
    // 3333 × 1500 bps = 499.95 → 500.
    const result = priceSale([line(3333, 1, true, { kind: 'percent', value: 1500 })], null);
    expect(result.lines[0].line_discount_cents).toBe(500);
    expect(result.total_cents).toBe(2833);
  });

  it('handles a 100% order discount: total 0, no VAT, valid', () => {
    const result = priceSale([line(5000, 2), line(4500, 1, false)], { kind: 'percent', value: 10000 });
    expect(result).toMatchObject({
      order_discount_cents: 14500,
      total_cents: 0,
      vatable_sales_cents: 0,
      vat_amount_cents: 0,
      vat_exempt_sales_cents: 0,
      valid: true,
    });
  });

  it('flags a line discount above its gross (the server answers 422) and caps it', () => {
    const result = priceSale([line(5000, 1, true, { kind: 'amount', value: 6000 }), line(3500, 1)], null);
    expect(result.lines[0]).toMatchObject({ line_discount_cents: 5000, net_cents: 0, discountExceedsGross: true });
    expect(result.valid).toBe(false);
    expect(result.total_cents).toBe(3500);
  });

  it('accepts a line discount exactly equal to its gross', () => {
    const result = priceSale([line(5000, 1, true, { kind: 'amount', value: 5000 })], null);
    expect(result.lines[0].discountExceedsGross).toBe(false);
    expect(result.valid).toBe(true);
  });

  it('flags an order discount above B and caps it at B', () => {
    const result = priceSale([line(5000, 1)], { kind: 'amount', value: 5001 });
    expect(result).toMatchObject({ order_discount_cents: 5000, total_cents: 0, orderDiscountExceedsBase: true, valid: false });
  });

  it('flags a sale over ₱10,000,000 (422 on items) and accepts one exactly at the limit', () => {
    expect(priceSale([line(1_000_000_000, 1)], null).tooLarge).toBe(false);
    const over = priceSale([line(100_000_000, 11)], null);
    expect(over.subtotal_cents).toBe(1_100_000_000);
    expect(over.tooLarge).toBe(true);
    expect(over.valid).toBe(false);
    expect(MAX_SUBTOTAL_CENTS).toBe(1_000_000_000);
  });

  it('stays exact where intermediate products pass 2^53 (BigInt)', () => {
    // D × net_i = 999,999,999 × 999,999,999 ≈ 10^18 > 2^53.
    const lines = [line(999_999_999, 1), line(1, 1)];
    const result = priceSale(lines, { kind: 'amount', value: 999_999_999 });
    expect(result.discount_base_cents).toBe(1_000_000_000);
    expect(result.lines.map((priced) => priced.order_discount_share_cents)).toEqual([999_999_998, 1]);
    expect(result.total_cents).toBe(1);
    // V × 10000 is also past 2^53 for a large vatable sale.
    const vat = priceSale([line(1_000_000_000, 1)], null);
    expect(vat.vatable_sales_cents).toBe(892_857_143);
    expect(vat.vat_amount_cents).toBe(107_142_857);
  });

  it('puts VAT-exempt lines in vat_exempt_sales only', () => {
    const result = priceSale([line(4500, 2, false)], null);
    expect(result).toMatchObject({ vatable_sales_cents: 0, vat_amount_cents: 0, vat_exempt_sales_cents: 9000, total_cents: 9000 });
  });

  it('prices an empty sale as zero', () => {
    expect(priceSale([], null)).toMatchObject({ subtotal_cents: 0, total_cents: 0, discount_cents: 0, valid: true });
  });

  it('refuses non-integer money (never floats)', () => {
    expect(() => priceSale([line(50.5, 1)], null)).toThrow(TypeError);
    expect(() => priceSale([line(5000, 1.5)], null)).toThrow(TypeError);
  });
});
