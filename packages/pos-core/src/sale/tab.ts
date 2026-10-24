/**
 * Dine-in tabs (docs/api-contract.md → Dine-in Tables & Tabs → §D and §E):
 * the remaining lines of a tab, the settlement pricing (the snapshots through
 * the Core Sale algorithm, then the service charge) and the request bodies of
 * `POST /tabs/{ulid}/rounds` and `POST /tabs/{ulid}/settle`.
 *
 * The server prices every settlement itself; the app runs the same maths for
 * the checkout display and for `client_total_cents` (the checksum).
 */
import { priceSale, type SalePricing } from './pricing';
import { pricingScPwd, scPwdRequestOf } from './scPwd';
import { computeServiceCharge } from './serviceCharge';
import type {
  DiscountAuthorization,
  OrderPaymentRequest,
  SaleDiscount,
  ScPwdRequest,
  Tab,
  TabItem,
  TabRoundRequest,
  TabSettleRequest,
} from '../contract/types';
import type { CartCustomer, CartLine } from './cart';

/** A tab's item lines with quantity still to settle, in the tab's order (round, then id). */
export function tabRemainingLines(tab: Pick<Tab, 'items'>): TabItem[] {
  return tab.items.filter((item) => item.remaining_qty > 0);
}

/** Σ `unit_price_cents × remaining_qty` (the same figure as the tab's `remaining_cents`). */
export function tabRemainingCents(items: readonly Pick<TabItem, 'unit_price_cents' | 'remaining_qty'>[]): number {
  return items.reduce((sum, item) => sum + item.unit_price_cents * Math.max(0, item.remaining_qty), 0);
}

/** One line of a settlement: a tab item, the quantity paid now and its own discount / SC/PWD mark. */
export type TabSettleLine = {
  item: Pick<TabItem, 'id' | 'unit_price_cents' | 'is_vatable'>;
  /** 1 … `remaining_qty`. */
  qty: number;
  discount: SaleDiscount | null;
  /** SC/PWD `items` mode: this line is marked (ignored otherwise). */
  scPwd: boolean;
};

export type TabSettlementOptions = {
  /** The branch's `service_charge_bps` (0 = none). */
  serviceChargeBps: number;
  /** The checkout's service-charge toggle (`service_charge` in the body); default `true`. */
  serviceCharge?: boolean;
};

/**
 * A settlement's pricing: the Core Sale result with `total_cents` = `T + S`.
 * The VAT figures stay those of `T` (the service charge is outside them).
 */
export type TabSettlementPricing = SalePricing & {
  /** `T`: the order total after every discount, before the service charge. */
  sale_total_cents: number;
  /** `S`. */
  service_charge_cents: number;
};

/** Prices the selected tab lines with their snapshot prices (Core Sale steps 1–9), then adds the service charge (§E). */
export function priceTabSettlement(
  lines: readonly TabSettleLine[],
  orderDiscount: SaleDiscount | null,
  scPwd: ScPwdRequest | null,
  options: TabSettlementOptions,
): TabSettlementPricing {
  const pricing = priceSale(
    lines.map((line) => ({
      unit_price_cents: line.item.unit_price_cents,
      qty: line.qty,
      is_vatable: line.item.is_vatable,
      discount: line.discount,
      sc_pwd: scPwd?.mode === 'items' && line.scPwd === true,
    })),
    orderDiscount,
    pricingScPwd(scPwd),
  );
  const on = options.serviceCharge !== false && options.serviceChargeBps > 0;
  const serviceCharge = on ? computeServiceCharge(pricing.total_cents, options.serviceChargeBps) : 0;
  return {
    ...pricing,
    sale_total_cents: pricing.total_cents,
    service_charge_cents: serviceCharge,
    total_cents: pricing.total_cents + serviceCharge,
  };
}

/** Every remaining line at its full remaining quantity, with no discounts (the starting point of "Pay"). */
export function wholeTabSettleLines(tab: Pick<Tab, 'items'>): TabSettleLine[] {
  return tabRemainingLines(tab).map((item) => ({ item, qty: item.remaining_qty, discount: null, scPwd: false }));
}

export type TabRoundRequestInput = {
  /** The round's ULID: also the `Idempotency-Key`. */
  ulid: string;
  lines: readonly Pick<CartLine, 'product' | 'qty' | 'notes'>[];
};

/** The `POST /tabs/{ulid}/rounds` body. Lines keep the cart's order, so `items.{i}` errors map back to lines. */
export function buildTabRoundRequest(input: TabRoundRequestInput): TabRoundRequest {
  return {
    ulid: input.ulid,
    items: input.lines.map((line) => ({
      product_id: line.product.id,
      qty: line.qty,
      notes: line.notes === null || line.notes.trim() === '' ? null : line.notes.trim(),
    })),
  };
}

export type TabSettleRequestInput = {
  /** The settlement ULID: also the `Idempotency-Key`. */
  ulid: string;
  /** The open shift. */
  shiftUlid: string;
  /** `null`: settle everything remaining (`items` omitted). */
  lines: readonly TabSettleLine[] | null;
  customer: CartCustomer | null;
  orderDiscount: SaleDiscount | null;
  scPwd: ScPwdRequest | null;
  /** The service-charge toggle: `false` waives it. */
  serviceCharge: boolean;
  /** T2: 2–10 equal shares, or `null`. */
  splitCount: number | null;
  payments: OrderPaymentRequest[];
  /** The app's `total_cents` (with the service charge): the checksum. */
  clientTotalCents: number;
  authorization: DiscountAuthorization | null;
};

/** The `POST /tabs/{ulid}/settle` body (mirrors `buildOrderRequest`). */
export function buildTabSettleRequest(input: TabSettleRequestInput): TabSettleRequest {
  const itemsMode = input.scPwd?.mode === 'items';
  const body: TabSettleRequest = {
    ulid: input.ulid,
    shift_ulid: input.shiftUlid,
    customer_id: input.customer?.id ?? null,
    notes: null,
    discount: input.orderDiscount
      ? { type: input.orderDiscount.type, kind: input.orderDiscount.kind, value: input.orderDiscount.value }
      : null,
    sc_pwd: scPwdRequestOf(input.scPwd),
    service_charge: input.serviceCharge,
    split_count: input.splitCount,
    payments: input.payments,
    client_total_cents: input.clientTotalCents,
    discount_authorization: input.authorization,
  };
  if (input.lines !== null) {
    body.items = input.lines.map((line) => ({
      tab_item_id: line.item.id,
      qty: line.qty,
      discount: line.discount ? { type: line.discount.type, kind: line.discount.kind, value: line.discount.value } : null,
      sc_pwd: itemsMode && line.scPwd === true,
    }));
  }
  return body;
}
