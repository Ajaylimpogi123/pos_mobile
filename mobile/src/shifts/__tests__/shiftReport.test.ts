/**
 * The tablet's shift report (docs/api-contract.md → Shifts & Reporting →
 * `ShiftReport` definitions): sales sums, cash net of change, cash in and
 * out, expected cash, variance, and by cashier. Plus the shift forms.
 */
import type { OrderPayment, PrintableOrder } from '@/services/types';
import { checkCashAmount, checkCloseNote, checkCountedCash, checkOpeningFloat, checkReason } from '@/shifts/shiftForms';
import { computeShiftReport } from '@/shifts/shiftReport';
import { makeOrder, makeScPwdOrder } from '@/test-utils/sale';

function sale(ulid: string, overrides: Partial<PrintableOrder> & { payments: OrderPayment[] }): PrintableOrder {
  return { ...makeOrder({ ulid }), ...overrides };
}

const cash = (amount: number, tendered: number, change: number): OrderPayment => ({
  method: 'cash',
  amount_cents: amount,
  tendered_cents: tendered,
  change_cents: change,
  reference_no: null,
});
const gcash = (amount: number): OrderPayment => ({ method: 'gcash', amount_cents: amount, tendered_cents: null, change_cents: 0, reference_no: 'R1' });

describe('computeShiftReport', () => {
  it('an empty shift: every figure 0, both methods (cash first), expected = the float, no variance while open', () => {
    const report = computeShiftReport({ openingFloatCents: 200000, countedCashCents: null, orders: [], movements: [] });
    expect(report).toEqual({
      orders_count: 0,
      items_sold: 0,
      gross_sales_cents: 0,
      discounts_cents: 0,
      net_sales_cents: 0,
      vatable_sales_cents: 0,
      vat_amount_cents: 0,
      vat_exempt_sales_cents: 0,
      by_payment_method: [
        { method: 'cash', orders_count: 0, amount_cents: 0 },
        { method: 'gcash', orders_count: 0, amount_cents: 0 },
      ],
      cash_in_cents: 0,
      cash_out_cents: 0,
      expected_cash_cents: 200000,
      variance_cents: null,
      by_cashier: [],
      needs_review_count: 0,
      voids_count: 0,
      voids_cents: 0,
      refunds_count: 0,
      refunds_cents: 0,
      refunds_by_method: [
        { method: 'cash', amount_cents: 0 },
        { method: 'gcash', amount_cents: 0 },
      ],
      net_after_refunds_cents: 0,
      sc_pwd_orders_count: 0,
      sc_pwd_vat_relief_cents: 0,
      sc_pwd_discount_cents: 0,
    });
  });

  describe('Voids & Refunds (Phase 7)', () => {
    it('a voided sale counts as a void, not a sale; a refunded sale is still a sale', () => {
      const voided = makeOrder({ ulid: 'V', status: 'voided' });
      const refunded = makeOrder({ ulid: 'R', status: 'partially_refunded' });
      const report = computeShiftReport({ openingFloatCents: 100000, countedCashCents: null, orders: [voided, refunded], movements: [] });
      expect(report).toMatchObject({
        orders_count: 1,
        net_sales_cents: 25700,
        voids_count: 1,
        voids_cents: 25700,
        by_payment_method: [
          { method: 'cash', orders_count: 1, amount_cents: 15700 },
          { method: 'gcash', orders_count: 1, amount_cents: 10000 },
        ],
        // Only the sale that stands is in the drawer: float + ₱157.00 cash.
        expected_cash_cents: 115700,
      });
      expect(report.by_cashier).toEqual([{ user_id: 3, name: 'Carla Cashier', orders_count: 1, net_sales_cents: 25700 }]);
    });

    it('refunds of the shift: counts, by method (cash first), net after refunds, and expected cash less cash refunds', () => {
      const refunds = [
        { amount_cents: 3369, payments: [{ method: 'cash' as const, amount_cents: 3369, reference_no: null }] },
        {
          amount_cents: 6738,
          payments: [
            { method: 'cash' as const, amount_cents: 2000, reference_no: null },
            { method: 'gcash' as const, amount_cents: 4738, reference_no: 'G1' },
          ],
        },
      ];
      const report = computeShiftReport({
        openingFloatCents: 100000,
        countedCashCents: 150000,
        orders: [makeOrder({ ulid: 'A', status: 'refunded' })],
        movements: [{ type: 'in', amountCents: 1000 }],
        refunds,
      });
      expect(report).toMatchObject({
        orders_count: 1,
        net_sales_cents: 25700,
        refunds_count: 2,
        refunds_cents: 10107,
        refunds_by_method: [
          { method: 'cash', amount_cents: 5369 },
          { method: 'gcash', amount_cents: 4738 },
        ],
        net_after_refunds_cents: 15593,
        // 100000 + 15700 cash sales + 1000 in − 5369 cash refunds.
        expected_cash_cents: 111331,
        variance_cents: 150000 - 111331,
      });
    });
  });

  it('sums worked example B twice; cash is net of change; split tender counts in both methods', () => {
    // Example B: ₱257.00, GCash ₱100.00 + cash ₱200.00 tendered, ₱43.00 change → cash kept ₱157.00.
    const orders = [makeOrder({ ulid: 'A' }), makeOrder({ ulid: 'B' })];
    const report = computeShiftReport({ openingFloatCents: 100000, countedCashCents: null, orders, movements: [] });
    expect(report).toMatchObject({
      orders_count: 2,
      items_sold: 12,
      gross_sales_cents: 55000,
      discounts_cents: 3600,
      net_sales_cents: 51400,
      vatable_sales_cents: 30424,
      vat_amount_cents: 3650,
      vat_exempt_sales_cents: 17326,
      by_payment_method: [
        { method: 'cash', orders_count: 2, amount_cents: 31400 },
        { method: 'gcash', orders_count: 2, amount_cents: 20000 },
      ],
      // 1000.00 + 314.00 (net of the 86.00 change): never the tendered 400.00.
      expected_cash_cents: 131400,
    });
  });

  it('a cash payment returned entirely as change still counts the order, with ₱0 kept', () => {
    const order = sale('Z', { total_cents: 5000, payments: [gcash(5000), cash(0, 1000, 1000)] });
    const report = computeShiftReport({ openingFloatCents: 0, countedCashCents: null, orders: [order], movements: [] });
    expect(report.by_payment_method).toEqual([
      { method: 'cash', orders_count: 1, amount_cents: 0 },
      { method: 'gcash', orders_count: 1, amount_cents: 5000 },
    ]);
    expect(report.expected_cash_cents).toBe(0);
  });

  it('expected = float + cash sales + cash in − cash out; variance = counted − expected (negative: short)', () => {
    const orders = [sale('1', { total_cents: 10000, payments: [cash(10000, 20000, 10000)] })];
    const movements = [
      { type: 'in' as const, amountCents: 50000 },
      { type: 'out' as const, amountCents: 30000 },
      { type: 'out' as const, amountCents: 75000 },
    ];
    const open = computeShiftReport({ openingFloatCents: 200000, countedCashCents: null, orders, movements });
    expect(open).toMatchObject({ cash_in_cents: 50000, cash_out_cents: 105000, expected_cash_cents: 155000, variance_cents: null });

    expect(computeShiftReport({ openingFloatCents: 200000, countedCashCents: 150000, orders, movements }).variance_cents).toBe(-5000);
    expect(computeShiftReport({ openingFloatCents: 200000, countedCashCents: 155000, orders, movements }).variance_cents).toBe(0);
    expect(computeShiftReport({ openingFloatCents: 200000, countedCashCents: 156000, orders, movements }).variance_cents).toBe(1000);
  });

  it('by cashier: net descending, then name; the latest name is shown', () => {
    const orders = [
      sale('1', { cashier: { id: 5, name: 'Ben' }, total_cents: 3000, placed_at: '2026-09-26T01:00:00Z', payments: [cash(3000, 3000, 0)] }),
      sale('2', { cashier: { id: 3, name: 'Carla' }, total_cents: 5000, placed_at: '2026-09-26T01:05:00Z', payments: [cash(5000, 5000, 0)] }),
      sale('3', { cashier: { id: 7, name: 'Abe' }, total_cents: 3000, placed_at: '2026-09-26T01:10:00Z', payments: [cash(3000, 3000, 0)] }),
      sale('4', { cashier: { id: 3, name: 'Carla C.' }, total_cents: 1000, placed_at: '2026-09-26T02:00:00Z', payments: [gcash(1000)] }),
    ];
    const report = computeShiftReport({ openingFloatCents: 0, countedCashCents: null, orders, movements: [] });
    expect(report.by_cashier).toEqual([
      { user_id: 3, name: 'Carla C.', orders_count: 2, net_sales_cents: 6000 },
      { user_id: 7, name: 'Abe', orders_count: 1, net_sales_cents: 3000 },
      { user_id: 5, name: 'Ben', orders_count: 1, net_sales_cents: 3000 },
    ]);
    expect(report.needs_review_count).toBe(0);
  });
});

describe('shift forms', () => {
  it('opening float: 0 allowed, up to ₱1,000,000.00', () => {
    expect(checkOpeningFloat('0')).toEqual({ value: 0, error: null });
    expect(checkOpeningFloat('2,000.50')).toEqual({ value: 200050, error: null });
    expect(checkOpeningFloat('').error).toMatch(/starting cash/);
    expect(checkOpeningFloat('abc').error).toMatch(/Enter an amount like/);
    expect(checkOpeningFloat('1000000.01').error).toBe("The starting cash can't be more than ₱1,000,000.00.");
  });

  it('cash movement: ₱0.01 to ₱1,000,000.00 and a reason (max 120)', () => {
    expect(checkCashAmount('0').error).toBe('The amount must be at least ₱0.01.');
    expect(checkCashAmount('500')).toEqual({ value: 50000, error: null });
    expect(checkCashAmount('1000000.01').error).toBe("The amount can't be more than ₱1,000,000.00.");
    expect(checkReason('   ').error).toBe('Enter a reason.');
    expect(checkReason(' Change fund ')).toEqual({ value: 'Change fund', error: null });
    expect(checkReason('x'.repeat(121)).error).toBe("The reason can't be longer than 120 characters.");
  });

  it('close: counted cash 0–₱10,000,000.00; the note is optional (max 255)', () => {
    expect(checkCountedCash('0')).toEqual({ value: 0, error: null });
    expect(checkCountedCash('').error).toBe('Enter the cash counted in the drawer.');
    expect(checkCountedCash('10000000.01').error).toBe("The counted cash can't be more than ₱10,000,000.00.");
    expect(checkCloseNote('  ')).toEqual({ value: null, error: null });
    expect(checkCloseNote('x'.repeat(256)).error).toBe("The note can't be longer than 255 characters.");
  });
});

describe('Senior Citizen / PWD Discount on the tablet\'s report', () => {
  it('counts the non-voided SC/PWD sales and sums their R and S; a sale stored before SC/PWD counts as none', () => {
    const exempt = makeScPwdOrder(true, { ulid: 'D' });
    const taxable = makeScPwdOrder(false, { ulid: 'F' });
    const voided = makeScPwdOrder(true, { ulid: 'V', status: 'voided' });
    const legacy = { ...makeOrder({ ulid: 'L' }), sc_pwd: undefined } as unknown as PrintableOrder;
    const report = computeShiftReport({
      openingFloatCents: 0,
      countedCashCents: null,
      orders: [exempt, taxable, voided, legacy],
      movements: [],
    });
    expect(report).toMatchObject({
      orders_count: 3,
      sc_pwd_orders_count: 2,
      sc_pwd_vat_relief_cents: 3161,
      sc_pwd_discount_cents: 5268 + 5900,
      // Discounts include R + S, as the server's `discount_cents` does.
      discounts_cents: 8429 + 5900 + 1800,
      voids_count: 1,
    });
  });
});
