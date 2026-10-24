/**
 * Dine-in Tables & Tabs §E (docs/api-contract.md): the service charge, the
 * equal split and the tab request bodies. Worked example K: worked example B
 * as a tab settled whole with `service_charge_bps = 1000` → `T = 25700`,
 * `S = 2570`, `total = 28270`; split 3 ways → `9424 · 9423 · 9423`.
 */
import { computeServiceCharge, equalSplitShares } from '@pos/core/sale/serviceCharge';
import {
  buildTabRoundRequest,
  buildTabSettleRequest,
  priceTabSettlement,
  tabRemainingCents,
  tabRemainingLines,
  wholeTabSettleLines,
  type TabSettleLine,
} from '@pos/core/sale/tab';
import { priceRefund } from '@pos/core/sale/refunds';
import { makeOrder } from '@/test-utils/sale';
import { makeTab, makeTabItem } from '@/test-utils/tabs';

function exampleKLines(): TabSettleLine[] {
  return wholeTabSettleLines(makeTab()).map((line, index) =>
    index === 0 ? { ...line, discount: { type: 'promo', kind: 'percent', value: 1000 } } : line,
  );
}

describe('computeServiceCharge', () => {
  it('rounds half up and is 0 without a rate', () => {
    expect(computeServiceCharge(25700, 1000)).toBe(2570);
    expect(computeServiceCharge(5, 1000)).toBe(1); // 0.5 → 1
    expect(computeServiceCharge(4, 1000)).toBe(0);
    expect(computeServiceCharge(25700, 0)).toBe(0);
    expect(computeServiceCharge(1_000_000_000, 2000)).toBe(200_000_000);
  });

  it('rejects negative or fractional input', () => {
    expect(() => computeServiceCharge(-1, 1000)).toThrow(TypeError);
    expect(() => computeServiceCharge(100, 10.5)).toThrow(TypeError);
  });
});

describe('equalSplitShares', () => {
  it('worked example K: 28270 in 3 → 9424 · 9423 · 9423', () => {
    expect(equalSplitShares(28270, 3)).toEqual([9424, 9423, 9423]);
  });

  it('adds up to the total, the extra centavos on the first shares', () => {
    const shares = equalSplitShares(1001, 4);
    expect(shares).toEqual([251, 250, 250, 250]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1001);
    expect(equalSplitShares(900, 3)).toEqual([300, 300, 300]);
  });

  it('rejects a non-positive count', () => {
    expect(() => equalSplitShares(100, 0)).toThrow(RangeError);
  });
});

describe('priceTabSettlement', () => {
  it('worked example K: T = 25700, S = 2570, total 28270', () => {
    const result = priceTabSettlement(exampleKLines(), { type: 'promo', kind: 'amount', value: 1000 }, null, { serviceChargeBps: 1000 });
    expect(result).toMatchObject({
      subtotal_cents: 27500,
      discount_cents: 1800,
      sale_total_cents: 25700,
      service_charge_cents: 2570,
      total_cents: 28270,
      // The service charge is outside the VAT figures.
      vatable_sales_cents: 15212,
      valid: true,
    });
  });

  it('waived, or a 0 rate: no service charge', () => {
    const waived = priceTabSettlement(exampleKLines(), { type: 'promo', kind: 'amount', value: 1000 }, null, { serviceChargeBps: 1000, serviceCharge: false });
    expect(waived).toMatchObject({ service_charge_cents: 0, total_cents: 25700 });
    const none = priceTabSettlement(exampleKLines(), { type: 'promo', kind: 'amount', value: 1000 }, null, { serviceChargeBps: 0 });
    expect(none.total_cents).toBe(25700);
  });
});

describe('tab lines', () => {
  it('keeps only the remaining quantities, in the tab order', () => {
    const tab = makeTab({
      items: [
        makeTabItem({ id: 1, qty: 2, settled_qty: 2 }),
        makeTabItem({ id: 2, qty: 3, cancelled_qty: 1 }),
        makeTabItem({ id: 3, round_no: 2, qty: 1 }),
      ],
    });
    expect(tabRemainingLines(tab).map((item) => [item.id, item.remaining_qty])).toEqual([
      [2, 2],
      [3, 1],
    ]);
    expect(tabRemainingCents(tabRemainingLines(tab))).toBe(22500 * 3);
  });
});

describe('request bodies', () => {
  it('a round: product, qty and trimmed notes in the cart order', () => {
    const product = { id: 4, category_id: 2, name: 'Sisig', sku: null, price_cents: 22500, is_vatable: true, is_available: true, track_stock: false };
    expect(
      buildTabRoundRequest({
        ulid: 'R1',
        lines: [
          { product, qty: 2, notes: ' Extra spicy ' },
          { product, qty: 1, notes: '  ' },
        ],
      }),
    ).toEqual({
      ulid: 'R1',
      items: [
        { product_id: 4, qty: 2, notes: 'Extra spicy' },
        { product_id: 4, qty: 1, notes: null },
      ],
    });
  });

  it('a settlement: tab items, service charge, split count; items omitted for "everything"', () => {
    const base = {
      ulid: 'S1',
      shiftUlid: 'SH1',
      customer: null,
      orderDiscount: null,
      scPwd: null,
      serviceCharge: true,
      splitCount: 3,
      payments: [{ method: 'cash' as const, amount_cents: 10000, reference_no: null }],
      clientTotalCents: 28270,
      authorization: null,
    };
    const body = buildTabSettleRequest({ ...base, lines: exampleKLines() });
    expect(body.items?.[0]).toEqual({ tab_item_id: 41, qty: 1, discount: { type: 'promo', kind: 'percent', value: 1000 }, sc_pwd: false });
    expect(body).toMatchObject({ ulid: 'S1', shift_ulid: 'SH1', service_charge: true, split_count: 3, client_total_cents: 28270 });
    expect('items' in buildTabSettleRequest({ ...base, lines: null })).toBe(false);
  });
});

describe('refunds of a settled tab (§E)', () => {
  const order = makeOrder({ service_charge_cents: 2570, total_cents: 28270 });

  it('a partial refund never returns S; the refund that leaves nothing returns it', () => {
    const [first, ...rest] = order.items;
    expect(priceRefund(order.items, { [first.id]: 1 }, false, 1200, 2570).service_charge_cents).toBe(0);
    const everything = Object.fromEntries(order.items.map((item) => [item.id, item.qty]));
    const full = priceRefund(order.items, everything, false, 1200, 2570);
    expect(full.service_charge_cents).toBe(2570);
    expect(full.amount_cents).toBe(28270);
    expect(rest.length).toBeGreaterThan(0);
  });
});
