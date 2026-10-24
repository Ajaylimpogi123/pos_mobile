/**
 * An offline sale as the device records it (docs/api-contract.md → Offline
 * Sales → Device rules → Local write), built from the **same** `priceCart`
 * result the checkout shows:
 *
 * - `order_no` = `{device code}-{business date YYYYMMDD}-{daily sequence}`,
 *   e.g. `T01-20260926-0005` (4 digits, up to 6).
 * - The **printable local order** (`PrintableOrder`): `invoice_no: null`,
 *   `order_no`, `queue_no` = the daily sequence, synthetic `items[].id` values
 *   (1..n), `source: "offline"`, `placed_at` = now. The payments are settled
 *   with the server's rules (change comes out of the cash), so the receipt
 *   prints the same figures the server will store.
 * - The **`OfflineOrder`** for `POST /sync/orders`: the `POST /orders` body
 *   without `discount_authorization`, plus `order_no`, `placed_at`,
 *   `cashier_id` and each line's `unit_price_cents` (the snapshot).
 *
 * Pure functions: integer centavos only, no clock or storage.
 */
import { buildOrderRequest } from '@pos/core/sale/order';
import type { SalePricing } from '@pos/core/sale/pricing';
import type {
  OfflineOrder,
  OrderItem,
  OrderPayment,
  OrderPaymentRequest,
  PrintableOrder,
  SaleDiscount,
  ScPwdRequest,
  UserRef,
} from '@/services/types';
import type { CartCustomer, CartLine } from '@/stores/cart';

// Order-number helpers live in @pos/core (shared with the web POS); re-exported for existing imports.
export {
  ORDER_NO_PATTERN,
  orderNumberLabel,
  parseOrderNo,
  shortOrderNumber,
  ticketNumberLabel,
  type ParsedOrderNo,
} from '@pos/core/sale/orderNumbers';


/** A device code as the contract allows it in `order_no`. */
export const DEVICE_CODE_PATTERN = /^[A-Z0-9]{1,8}$/;

/** The largest daily sequence `order_no` can hold (6 digits). */
export const MAX_DAILY_SEQUENCE = 999_999;

/** `T01` + `2026-09-26` + 5 → `T01-20260926-0005`. */
export function formatOrderNo(deviceCode: string, businessDate: string, sequence: number): string {
  if (!DEVICE_CODE_PATTERN.test(deviceCode)) throw new RangeError(`Invalid device code: ${deviceCode}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) throw new RangeError(`Invalid business date: ${businessDate}`);
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > MAX_DAILY_SEQUENCE) {
    throw new RangeError(`Invalid daily sequence: ${String(sequence)}`);
  }
  return `${deviceCode}-${businessDate.replace(/-/g, '')}-${String(sequence).padStart(4, '0')}`;
}


/** A sale saved on this device and not yet given an invoice number by the server. */
export function isLocalOrder(order: Pick<PrintableOrder, 'invoice_no'>): boolean {
  return order.invoice_no === null;
}


/** An ISO 8601 UTC time without milliseconds, like the contract's examples. */
export function isoSeconds(time: number): string {
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export type SettledPayments = {
  payments: OrderPayment[];
  tendered_cents: number;
  change_cents: number;
};

/**
 * The payments as the server stores them (POST /orders → "Stored payments"):
 * cash keeps `tendered_cents` = the amount handed over and gives the change
 * (sum − total, never below 0); GCash is stored as sent. With no cash, the
 * change is 0.
 */
export function settlePayments(totalCents: number, payments: readonly OrderPaymentRequest[]): SettledPayments {
  const paid = payments.reduce((sum, payment) => sum + payment.amount_cents, 0);
  const hasCash = payments.some((payment) => payment.method === 'cash');
  const change = hasCash ? Math.max(0, paid - totalCents) : 0;
  return {
    payments: payments.map((payment) =>
      payment.method === 'cash'
        ? {
            method: 'cash',
            amount_cents: payment.amount_cents - change,
            tendered_cents: payment.amount_cents,
            change_cents: change,
            reference_no: null,
          }
        : {
            method: payment.method,
            amount_cents: payment.amount_cents,
            tendered_cents: null,
            change_cents: 0,
            reference_no: payment.reference_no,
          },
    ),
    tendered_cents: paid,
    change_cents: change,
  };
}

export type LocalSaleInput = {
  /** The sale's ULID (the pending one, when an online attempt came first). */
  ulid: string;
  lines: readonly CartLine[];
  orderDiscount: SaleDiscount | null;
  customer: CartCustomer | null;
  /** Checked and trimmed (`parseTableNo`), or `null`. */
  tableNo: string | null;
  payments: OrderPaymentRequest[];
  /** `priceCart(lines, orderDiscount)`. */
  pricing: SalePricing;
  cashier: UserRef;
  /** The device clock when the sale was confirmed (ISO 8601 UTC). */
  placedAt: string;
  /** `YYYY-MM-DD`: the branch's business date at `placedAt`. */
  businessDate: string;
  /** The device's code, e.g. `T01`. */
  deviceCode: string;
  /** The daily sequence from `order_counters`. */
  sequence: number;
  /** Category names from the on-device menu, by id (a missing one prints as ''). */
  categoryNames: ReadonlyMap<number, string>;
  /** Shifts & Reporting (Phase 6): the tablet's open shift. */
  shiftUlid: string;
  /** Senior Citizen / PWD Discount: the cart's SC/PWD (priced into `pricing`), or `null`. */
  scPwd: ScPwdRequest | null;
};

/** The printable local order of an offline sale (see the module notes). */
export function buildLocalOrder(input: LocalSaleInput): PrintableOrder {
  const { pricing } = input;
  const orderNo = formatOrderNo(input.deviceCode, input.businessDate, input.sequence);
  const settled = settlePayments(pricing.total_cents, input.payments);

  const items: OrderItem[] = input.lines.map((line, index) => {
    const priced = pricing.lines[index];
    return {
      // Synthetic ids (1..n): kitchen tickets select their lines by `items[].id`.
      id: index + 1,
      product_id: line.product.id,
      product_name: line.product.name,
      category_id: line.product.category_id,
      category_name: input.categoryNames.get(line.product.category_id) ?? '',
      sku: line.product.sku,
      qty: line.qty,
      unit_price_cents: line.product.price_cents,
      gross_cents: priced.gross_cents,
      is_vatable: line.product.is_vatable,
      discount: line.discount ? { type: line.discount.type, kind: line.discount.kind, value: line.discount.value } : null,
      line_discount_cents: priced.line_discount_cents,
      order_discount_share_cents: priced.order_discount_share_cents,
      line_total_cents: priced.line_total_cents,
      notes: line.notes,
      // Voids & Refunds (Phase 7): an offline sale is never refunded before it syncs.
      refunded_qty: 0,
      refunded_cents: 0,
      // Senior Citizen / PWD Discount: the same pricing result as the checkout and the checksum.
      sc_pwd: priced.sc_pwd,
      sc_pwd_eligible_cents: priced.sc_pwd_eligible_cents,
      sc_pwd_vat_relief_cents: priced.sc_pwd_vat_relief_cents,
      sc_pwd_discount_cents: priced.sc_pwd_discount_cents,
    };
  });

  return {
    ulid: input.ulid,
    invoice_no: null,
    queue_no: input.sequence,
    table_no: input.tableNo,
    // Dine-in: an offline sale is always pay-now (settlements are never queued).
    tab_ulid: null,
    service_charge_cents: 0,
    split_count: null,
    business_date: input.businessDate,
    status: 'completed',
    placed_at: input.placedAt,
    cashier: { id: input.cashier.id, name: input.cashier.name },
    authorized_by: null,
    customer: input.customer ? { id: input.customer.id, full_name: input.customer.full_name } : null,
    notes: null,
    subtotal_cents: pricing.subtotal_cents,
    line_discounts_cents: pricing.line_discounts_cents,
    order_discount: input.orderDiscount
      ? {
          type: input.orderDiscount.type,
          kind: input.orderDiscount.kind,
          value: input.orderDiscount.value,
          amount_cents: pricing.order_discount_cents,
        }
      : null,
    discount_cents: pricing.discount_cents,
    total_cents: pricing.total_cents,
    vatable_sales_cents: pricing.vatable_sales_cents,
    vat_amount_cents: pricing.vat_amount_cents,
    vat_exempt_sales_cents: pricing.vat_exempt_sales_cents,
    tendered_cents: settled.tendered_cents,
    change_cents: settled.change_cents,
    client_total_cents: pricing.total_cents,
    has_total_mismatch: false,
    items,
    payments: settled.payments,
    shift_ulid: input.shiftUlid,
    order_no: orderNo,
    source: 'offline',
    needs_review: false,
    review_reasons: [],
    reviewed_at: null,
    reviewed_by: null,
    synced_at: null,
    // Voids & Refunds (Phase 7): nothing reversed.
    voided_at: null,
    voided_by: null,
    void_reason: null,
    void_authorized_by: null,
    refunded_cents: 0,
    refunds: [],
    sc_pwd: input.scPwd
      ? {
          mode: input.scPwd.mode,
          persons: input.scPwd.persons.map((person) => ({ type: person.type, id_no: person.id_no })),
          diners: input.scPwd.mode === 'headcount' ? input.scPwd.diners : null,
          vat_exempt: input.scPwd.vat_exempt,
          vat_relief_cents: pricing.sc_pwd_vat_relief_cents,
          discount_cents: pricing.sc_pwd_discount_cents,
        }
      : null,
  };
}

/** The `OfflineOrder` of an offline sale: exactly what `POST /sync/orders` receives for it. */
export function buildOfflineOrder(input: LocalSaleInput): OfflineOrder {
  const body = buildOrderRequest({
    ulid: input.ulid,
    lines: input.lines,
    orderDiscount: input.orderDiscount,
    customer: input.customer,
    tableNo: input.tableNo,
    payments: input.payments,
    clientTotalCents: input.pricing.total_cents,
    authorization: null,
    shiftUlid: input.shiftUlid,
    scPwd: input.scPwd,
  });
  return {
    ulid: body.ulid,
    customer_id: body.customer_id,
    notes: body.notes,
    table_no: body.table_no,
    items: body.items.map((item, index) => ({ ...item, unit_price_cents: input.lines[index].product.price_cents })),
    discount: body.discount,
    payments: body.payments,
    client_total_cents: body.client_total_cents,
    order_no: formatOrderNo(input.deviceCode, input.businessDate, input.sequence),
    placed_at: input.placedAt,
    cashier_id: input.cashier.id,
    shift_ulid: body.shift_ulid,
    sc_pwd: body.sc_pwd,
  };
}
