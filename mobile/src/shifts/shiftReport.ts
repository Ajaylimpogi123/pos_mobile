/**
 * The tablet's own shift report (docs/api-contract.md → Shifts & Reporting →
 * `ShiftReport` and Device rules → Reports on the tablet). The X-read and
 * the Z-read are computed from **local data**, so they print offline too; the
 * server's report stays the record of truth.
 *
 * Definitions (the same as the server's, with Voids & Refunds, Phase 7):
 * - Sales figures: sums over the shift's orders that are **not `voided`** (a
 *   refunded sale is still a sale), with the dashboard `sales` fields
 *   (`gross` = Σ `subtotal_cents`, `discounts` = Σ `discount_cents`, `net` =
 *   Σ `total_cents`, `items_sold` = Σ `qty`).
 * - Voids: `voids_count` / `voids_cents` (Σ `total_cents`) of the voided orders.
 * - Refunds: the refunds made in this shift (`local_refunds` with its ULID):
 *   `refunds_count`, `refunds_cents` (Σ `amount_cents`), `refunds_by_method`
 *   (always both, cash first), and `net_after_refunds_cents` = net − refunds.
 * - `by_payment_method`: always both methods, cash first. `orders_count`
 *   counts orders with at least one payment of that method; `amount_cents`
 *   is Σ the stored `amount_cents`, so cash is **net of change**.
 * - `expected_cash_cents` = opening float + cash sales + cash in − cash out − cash refunds.
 * - `variance_cents` = counted − expected; `null` while the shift is open.
 * - `by_cashier`: `net_sales_cents` descending, then name (then user id).
 * - `needs_review_count`: counted on the server only, so always 0 here.
 * - Senior Citizen / PWD Discount: `sc_pwd_orders_count` (the sales with
 *   SC/PWD), `sc_pwd_vat_relief_cents` (Σ `sc_pwd.vat_relief_cents`) and
 *   `sc_pwd_discount_cents` (Σ `sc_pwd.discount_cents`), over the same sales.
 * - Dine-in Tables & Tabs: `service_charge_cents` (Σ `service_charge_cents`)
 *   over the same sales; `net_sales_cents` already includes it.
 *
 * A pure function: integer centavos only, no clock, no storage.
 */
import type {
  CashMovementType,
  PaymentMethod,
  PrintableOrder,
  Refund,
  ShiftReport,
  ShiftReportCashier,
} from '@/services/types';

export { cashRefundsOf } from '@pos/core/shifts/cashRefunds';

export type ShiftReportMovement = { type: CashMovementType; amountCents: number };

export type ShiftReportInput = {
  openingFloatCents: number;
  /** `null` while the shift is open (then `variance_cents` is `null`). */
  countedCashCents: number | null;
  /** The shift's sales (a synced sale: its server `Order`). */
  orders: readonly PrintableOrder[];
  movements: readonly ShiftReportMovement[];
  /** Phase 7: the refunds made in this shift on this tablet. */
  refunds?: readonly Pick<Refund, 'amount_cents' | 'payments'>[];
};

const METHODS: readonly PaymentMethod[] = ['cash', 'gcash'];

type CashierTotals = ShiftReportCashier & { lastPlacedAt: string };

export function computeShiftReport(input: ShiftReportInput): ShiftReport {
  const sales = input.orders.filter((order) => order.status !== 'voided');
  const voided = input.orders.filter((order) => order.status === 'voided');

  let itemsSold = 0;
  let gross = 0;
  let discounts = 0;
  let net = 0;
  let vatable = 0;
  let vat = 0;
  let vatExempt = 0;
  let scPwdOrders = 0;
  let scPwdRelief = 0;
  let scPwdDiscount = 0;
  let serviceCharge = 0;
  const methods = new Map<PaymentMethod, { orders: number; amount: number }>(METHODS.map((method) => [method, { orders: 0, amount: 0 }]));
  const cashiers = new Map<number, CashierTotals>();

  for (const order of sales) {
    for (const item of order.items) itemsSold += item.qty;
    gross += order.subtotal_cents;
    discounts += order.discount_cents;
    net += order.total_cents;
    vatable += order.vatable_sales_cents;
    vat += order.vat_amount_cents;
    vatExempt += order.vat_exempt_sales_cents;
    // An order stored before Dine-in has no `service_charge_cents`.
    serviceCharge += order.service_charge_cents ?? 0;
    // An order stored before SC/PWD has no `sc_pwd`.
    if (order.sc_pwd) {
      scPwdOrders += 1;
      scPwdRelief += order.sc_pwd.vat_relief_cents;
      scPwdDiscount += order.sc_pwd.discount_cents;
    }

    const used = new Set<PaymentMethod>();
    for (const payment of order.payments) {
      const totals = methods.get(payment.method);
      if (!totals) continue;
      totals.amount += payment.amount_cents;
      used.add(payment.method);
    }
    for (const method of used) {
      const totals = methods.get(method);
      if (totals) totals.orders += 1;
    }

    const cashier = cashiers.get(order.cashier.id);
    if (!cashier) {
      cashiers.set(order.cashier.id, {
        user_id: order.cashier.id,
        name: order.cashier.name,
        orders_count: 1,
        net_sales_cents: order.total_cents,
        lastPlacedAt: order.placed_at,
      });
    } else {
      cashier.orders_count += 1;
      cashier.net_sales_cents += order.total_cents;
      // The most recent name, as the server shows the current record.
      if (order.placed_at >= cashier.lastPlacedAt) {
        cashier.name = order.cashier.name;
        cashier.lastPlacedAt = order.placed_at;
      }
    }
  }

  const voidsCents = voided.reduce((sum, order) => sum + order.total_cents, 0);

  const refunds = input.refunds ?? [];
  const refundsByMethod = new Map<PaymentMethod, number>(METHODS.map((method) => [method, 0]));
  let refundsCents = 0;
  for (const refund of refunds) {
    refundsCents += refund.amount_cents;
    for (const payment of refund.payments) {
      if (refundsByMethod.has(payment.method)) refundsByMethod.set(payment.method, (refundsByMethod.get(payment.method) ?? 0) + payment.amount_cents);
    }
  }

  let cashIn = 0;
  let cashOut = 0;
  for (const movement of input.movements) {
    if (movement.type === 'in') cashIn += movement.amountCents;
    else cashOut += movement.amountCents;
  }

  const cashSales = methods.get('cash')?.amount ?? 0;
  const cashRefunds = refundsByMethod.get('cash') ?? 0;
  const expected = input.openingFloatCents + cashSales + cashIn - cashOut - cashRefunds;

  const byCashier = [...cashiers.values()]
    .sort((a, b) => {
      if (a.net_sales_cents !== b.net_sales_cents) return b.net_sales_cents - a.net_sales_cents;
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      return a.user_id - b.user_id;
    })
    .map(({ user_id, name, orders_count, net_sales_cents }) => ({ user_id, name, orders_count, net_sales_cents }));

  return {
    orders_count: sales.length,
    items_sold: itemsSold,
    gross_sales_cents: gross,
    discounts_cents: discounts,
    net_sales_cents: net,
    vatable_sales_cents: vatable,
    vat_amount_cents: vat,
    vat_exempt_sales_cents: vatExempt,
    by_payment_method: METHODS.map((method) => ({
      method,
      orders_count: methods.get(method)?.orders ?? 0,
      amount_cents: methods.get(method)?.amount ?? 0,
    })),
    cash_in_cents: cashIn,
    cash_out_cents: cashOut,
    expected_cash_cents: expected,
    variance_cents: input.countedCashCents === null ? null : input.countedCashCents - expected,
    by_cashier: byCashier,
    needs_review_count: 0,
    voids_count: voided.length,
    voids_cents: voidsCents,
    refunds_count: refunds.length,
    refunds_cents: refundsCents,
    refunds_by_method: METHODS.map((method) => ({ method, amount_cents: refundsByMethod.get(method) ?? 0 })),
    net_after_refunds_cents: net - refundsCents,
    sc_pwd_orders_count: scPwdOrders,
    sc_pwd_vat_relief_cents: scPwdRelief,
    sc_pwd_discount_cents: scPwdDiscount,
    service_charge_cents: serviceCharge,
  };
}

/** `counted − expected`, the live figure the close dialog shows. */
export function varianceOf(countedCashCents: number, expectedCashCents: number): number {
  return countedCashCents - expectedCashCents;
}
