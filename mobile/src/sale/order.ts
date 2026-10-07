/**
 * The cart as a sale: its pricing (the same algorithm the server runs) and
 * the `POST /api/v1/orders` body built from it.
 */
import { priceSale, type SalePricing } from '@/sale/pricing';
import { pricingScPwd, scPwdRequestOf } from '@/sale/scPwd';
import type {
  DiscountAuthorization,
  OrderCreateRequest,
  OrderPaymentRequest,
  SaleDiscount,
  ScPwdRequest,
} from '@/services/types';
import type { CartCustomer, CartLine } from '@/stores/cart';

/**
 * Prices the cart's lines, order discount and SC/PWD (see `@/sale/pricing`).
 * A line's SC/PWD mark only counts in `items` mode.
 */
export function priceCart(
  lines: readonly CartLine[],
  orderDiscount: SaleDiscount | null,
  scPwd: ScPwdRequest | null = null,
): SalePricing {
  return priceSale(
    lines.map((line) => ({
      unit_price_cents: line.product.price_cents,
      qty: line.qty,
      is_vatable: line.product.is_vatable,
      discount: line.discount,
      sc_pwd: scPwd?.mode === 'items' && line.scPwd === true,
    })),
    orderDiscount,
    pricingScPwd(scPwd),
  );
}

export type OrderRequestInput = {
  /** The pending sale ULID: also the `Idempotency-Key`. */
  ulid: string;
  lines: readonly CartLine[];
  orderDiscount: SaleDiscount | null;
  customer: CartCustomer | null;
  /** The checked table number (`parseTableNo`), or `null`. */
  tableNo: string | null;
  payments: OrderPaymentRequest[];
  /** The app's `total_cents` for this cart: the checksum. */
  clientTotalCents: number;
  authorization: DiscountAuthorization | null;
  /** Shifts & Reporting (Phase 6): the tablet's open shift. */
  shiftUlid: string;
  /** Senior Citizen / PWD Discount: the cart's SC/PWD, or `null`. */
  scPwd: ScPwdRequest | null;
};

/** The `POST /api/v1/orders` body. Lines keep the cart's order, so `items.{i}` errors map back to lines. */
export function buildOrderRequest(input: OrderRequestInput): OrderCreateRequest {
  const itemsMode = input.scPwd?.mode === 'items';
  return {
    ulid: input.ulid,
    customer_id: input.customer?.id ?? null,
    notes: null,
    table_no: input.tableNo,
    items: input.lines.map((line) => ({
      product_id: line.product.id,
      qty: line.qty,
      discount: line.discount ? { type: line.discount.type, kind: line.discount.kind, value: line.discount.value } : null,
      notes: line.notes,
      // `items` mode only: `headcount` and no SC/PWD send `false` on every line.
      sc_pwd: itemsMode && line.scPwd === true,
    })),
    discount: input.orderDiscount
      ? { type: input.orderDiscount.type, kind: input.orderDiscount.kind, value: input.orderDiscount.value }
      : null,
    payments: input.payments,
    client_total_cents: input.clientTotalCents,
    discount_authorization: input.authorization,
    shift_ulid: input.shiftUlid,
    sc_pwd: scPwdRequestOf(input.scPwd),
  };
}
