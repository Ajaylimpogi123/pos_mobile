/**
 * Test-only fixtures for Core Sale (Phase 3), shaped exactly like the
 * contract examples (worked example B, `Order`, `OrderSummary`, `pin-users`,
 * the dashboard `sales` section, a stock movement). Never import from app code.
 */
import type {
  DashboardSales,
  Order,
  OrderSummary,
  PinUser,
  Refund,
  StockMovement,
} from '@/services/types';
import type { CartProduct } from '@/stores/cart';
import { useCartStore } from '@/stores/cart';

/** Phase 6: the open shift the fixtures' sales belong to (see `@/test-utils/shifts`). */
export const TEST_SHIFT_ULID = '01K6S0A1B2C3D4E5F6G7H8J9KM';

/** A cart product snapshot (as the Sell screen takes it from SQLite). */
export function cartProduct(overrides: Partial<CartProduct> & { id: number }): CartProduct {
  return {
    category_id: 1,
    name: `Product ${overrides.id}`,
    sku: null,
    price_cents: 5000,
    is_vatable: true,
    is_available: true,
    track_stock: false,
    ...overrides,
  };
}

/** Worked example B's products (ids as in the contract's request example). */
export const HOT_DOG = cartProduct({ id: 4, category_id: 1, name: 'Hot Dog', sku: 'BRK-002', price_cents: 8000 });
export const RICE_CAKE = cartProduct({ id: 11, category_id: 2, name: 'Rice Cake', price_cents: 4500, is_vatable: false });
export const ICED_TEA = cartProduct({ id: 9, category_id: 3, name: 'Iced Tea', sku: 'DRK-001', price_cents: 3500, track_stock: true });

/**
 * Fills the cart with worked example B: Hot Dog × 1 with a 10% promo line
 * discount and a note, Rice Cake × 2 (VAT-exempt), Iced Tea × 3, and a ₱10.00
 * promo order discount. Total ₱257.00.
 */
export function fillCartWithExampleB(): void {
  const cart = useCartStore.getState();
  cart.addProduct(HOT_DOG);
  cart.addProduct(RICE_CAKE);
  cart.addProduct(ICED_TEA);
  const [hotDog, riceCake, tea] = useCartStore.getState().lines;
  cart.updateLine(hotDog.key, { qty: 1, discount: { type: 'promo', kind: 'percent', value: 1000 }, notes: 'No ketchup' });
  cart.setQty(riceCake.key, 2);
  cart.setQty(tea.key, 3);
  cart.setOrderDiscount({ type: 'promo', kind: 'amount', value: 1000 });
}

/**
 * `Order` exactly as the contract example (worked example B, cash + GCash).
 * Phase 4 adds `items[].category_id`: the dev seed categories Breakfast (1),
 * Meals (2) and Drinks (3), as in `seedMenu()`. Phase 5 adds the sync fields
 * of an online order (`source: 'online'`, no `order_no`, not flagged).
 */
export function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    ulid: '01K62Z3K5Q9V7X2M4N6P8R0T1W',
    invoice_no: 'INV-MAIN-00000042',
    queue_no: 17,
    table_no: null,
    business_date: '2026-09-25',
    status: 'completed',
    placed_at: '2026-09-25T04:12:09Z',
    cashier: { id: 3, name: 'Carla Cashier' },
    authorized_by: null,
    customer: { id: 12, full_name: 'Maria Santos' },
    notes: null,
    subtotal_cents: 27500,
    line_discounts_cents: 800,
    order_discount: { type: 'promo', kind: 'amount', value: 1000, amount_cents: 1000 },
    discount_cents: 1800,
    total_cents: 25700,
    vatable_sales_cents: 15212,
    vat_amount_cents: 1825,
    vat_exempt_sales_cents: 8663,
    tendered_cents: 30000,
    change_cents: 4300,
    client_total_cents: 25700,
    has_total_mismatch: false,
    items: [
      {
        id: 101,
        product_id: 4,
        product_name: 'Hot Dog',
        category_id: 1,
        category_name: 'Breakfast',
        sku: 'BRK-002',
        qty: 1,
        unit_price_cents: 8000,
        gross_cents: 8000,
        is_vatable: true,
        discount: { type: 'promo', kind: 'percent', value: 1000 },
        line_discount_cents: 800,
        order_discount_share_cents: 270,
        line_total_cents: 6930,
        notes: 'No ketchup',
        refunded_qty: 0,
        refunded_cents: 0,
        sc_pwd: false,
        sc_pwd_eligible_cents: 0,
        sc_pwd_vat_relief_cents: 0,
        sc_pwd_discount_cents: 0,
      },
      {
        id: 102,
        product_id: 11,
        product_name: 'Rice Cake',
        category_id: 2,
        category_name: 'Meals',
        sku: null,
        qty: 2,
        unit_price_cents: 4500,
        gross_cents: 9000,
        is_vatable: false,
        discount: null,
        line_discount_cents: 0,
        order_discount_share_cents: 337,
        line_total_cents: 8663,
        notes: null,
        refunded_qty: 0,
        refunded_cents: 0,
        sc_pwd: false,
        sc_pwd_eligible_cents: 0,
        sc_pwd_vat_relief_cents: 0,
        sc_pwd_discount_cents: 0,
      },
      {
        id: 103,
        product_id: 9,
        product_name: 'Iced Tea',
        category_id: 3,
        category_name: 'Drinks',
        sku: 'DRK-001',
        qty: 3,
        unit_price_cents: 3500,
        gross_cents: 10500,
        is_vatable: true,
        discount: null,
        line_discount_cents: 0,
        order_discount_share_cents: 393,
        line_total_cents: 10107,
        notes: null,
        refunded_qty: 0,
        refunded_cents: 0,
        sc_pwd: false,
        sc_pwd_eligible_cents: 0,
        sc_pwd_vat_relief_cents: 0,
        sc_pwd_discount_cents: 0,
      },
    ],
    payments: [
      { method: 'gcash', amount_cents: 10000, tendered_cents: null, change_cents: 0, reference_no: '1012345678901' },
      { method: 'cash', amount_cents: 15700, tendered_cents: 20000, change_cents: 4300, reference_no: null },
    ],
    sc_pwd: null,
    order_no: null,
    source: 'online',
    needs_review: false,
    review_reasons: [],
    reviewed_at: null,
    reviewed_by: null,
    synced_at: null,
    shift_ulid: TEST_SHIFT_ULID,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    void_authorized_by: null,
    refunded_cents: 0,
    refunds: [],
    ...overrides,
  };
}

/**
 * Worked example C's first refund (Voids & Refunds, Phase 7): 1 of the 3
 * Iced Teas on line 3 of `makeOrder()`, paid back in cash.
 */
export function makeRefund(overrides: Partial<Refund> = {}): Refund {
  return {
    ulid: '01K6R0A1B2C3D4E5F6G7H8J9KM',
    business_date: '2026-09-27',
    refunded_at: '2026-09-27T05:10:00Z',
    shift_ulid: TEST_SHIFT_ULID,
    refunded_by: { id: 3, name: 'Carla Cashier' },
    authorized_by: { id: 2, name: 'Marco Manager' },
    reason: 'Wrong drink',
    amount_cents: 3369,
    vatable_sales_cents: 3008,
    vat_amount_cents: 361,
    vat_exempt_sales_cents: 0,
    items: [{ order_item_id: 103, product_name: 'Iced Tea', qty: 1, amount_cents: 3369 }],
    payments: [{ method: 'cash', amount_cents: 3369, reference_no: null }],
    ...overrides,
  };
}

/** `makeOrder()` after worked example C's first refund: `partially_refunded`, line 3 with 1 refunded. */
export function makePartlyRefundedOrder(refund: Refund = makeRefund()): Order {
  const order = makeOrder();
  return {
    ...order,
    status: 'partially_refunded',
    refunded_cents: refund.amount_cents,
    refunds: [refund],
    items: order.items.map((item) =>
      item.id === 103 ? { ...item, refunded_qty: 1, refunded_cents: refund.amount_cents } : item,
    ),
  };
}

/** `makeOrder()` voided within its shift by the cashier, approved by the manager. */
export function makeVoidedOrder(overrides: Partial<Order> = {}): Order {
  return makeOrder({
    status: 'voided',
    voided_at: '2026-09-25T04:20:00Z',
    voided_by: { id: 3, name: 'Carla Cashier' },
    void_reason: 'Customer cancelled',
    void_authorized_by: { id: 2, name: 'Marco Manager' },
    ...overrides,
  });
}

/** `OrderSummary` as the contract example. */
export function makeOrderSummary(overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    ulid: '01K62Z3K5Q9V7X2M4N6P8R0T1W',
    invoice_no: 'INV-MAIN-00000042',
    queue_no: 17,
    table_no: null,
    business_date: '2026-09-25',
    status: 'completed',
    placed_at: '2026-09-25T04:12:09Z',
    cashier: { id: 3, name: 'Carla Cashier' },
    customer: { id: 12, full_name: 'Maria Santos' },
    items_count: 6,
    total_cents: 25700,
    payment_methods: ['cash', 'gcash'],
    refunded_cents: 0,
    has_sc_pwd: false,
    order_no: null,
    source: 'online',
    needs_review: false,
    review_reasons: [],
    reviewed_at: null,
    reviewed_by: null,
    synced_at: null,
    shift_ulid: TEST_SHIFT_ULID,
    ...overrides,
  };
}

export function pinUser(overrides: Partial<PinUser> & { id: number }): PinUser {
  return {
    name: `Person ${overrides.id}`,
    role: { slug: 'cashier', name: 'Cashier' },
    can_approve_discounts: false,
    max_discount_percent: 10,
    can_approve_voids: false,
    can_approve_refunds: false,
    ...overrides,
  };
}

/** `pin-users` of the dev seed: the owner (100%), a manager with a 15% limit, and the cashier. */
export const PIN_USERS: PinUser[] = [
  pinUser({ id: 3, name: 'Carla Cashier' }),
  pinUser({
    id: 2,
    name: 'Marco Manager',
    role: { slug: 'manager', name: 'Manager' },
    can_approve_discounts: true,
    max_discount_percent: 15,
    can_approve_voids: true,
    can_approve_refunds: true,
  }),
  pinUser({
    id: 1,
    name: 'Olga Owner',
    role: { slug: 'owner', name: 'Owner' },
    can_approve_discounts: true,
    max_discount_percent: 100,
    can_approve_voids: true,
    can_approve_refunds: true,
  }),
];

const LAST_7 = ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'];

/** The dashboard `sales` section as the contract example. */
export function makeSales(overrides: Partial<DashboardSales> = {}): DashboardSales {
  const counts = [0, 3, 5, 0, 8, 10, 12];
  const nets = [0, 95000, 180000, 0, 250000, 331000, 403000];
  return {
    business_date: '2026-09-25',
    orders_count: 12,
    items_sold: 34,
    gross_sales_cents: 412000,
    discounts_cents: 9000,
    net_sales_cents: 403000,
    vat_amount_cents: 38250,
    average_order_cents: 33583,
    by_payment_method: [
      { method: 'cash', orders_count: 9, amount_cents: 300000 },
      { method: 'gcash', orders_count: 4, amount_cents: 103000 },
    ],
    last_7_days: LAST_7.map((date, index) => ({ date, orders_count: counts[index], net_sales_cents: nets[index] })),
    top_products: [{ product_id: 9, name: 'Iced Tea', qty: 14, net_sales_cents: 45000 }],
    voids_count: 0,
    refunds_cents: 0,
    net_after_refunds_cents: 403000,
    sc_pwd_orders_count: 0,
    sc_pwd_vat_relief_cents: 0,
    sc_pwd_discount_cents: 0,
    ...overrides,
  };
}

/** No sales at all this week: every figure 0, the lists keep their fixed shapes. */
export function noSales(): DashboardSales {
  return makeSales({
    orders_count: 0,
    items_sold: 0,
    gross_sales_cents: 0,
    discounts_cents: 0,
    net_sales_cents: 0,
    vat_amount_cents: 0,
    average_order_cents: 0,
    by_payment_method: [
      { method: 'cash', orders_count: 0, amount_cents: 0 },
      { method: 'gcash', orders_count: 0, amount_cents: 0 },
    ],
    last_7_days: LAST_7.map((date) => ({ date, orders_count: 0, net_sales_cents: 0 })),
    top_products: [],
    voids_count: 0,
    refunds_cents: 0,
    net_after_refunds_cents: 0,
  });
}

/** The contract's stock-adjustment 201 example. */
export function makeStockMovement(overrides: Partial<StockMovement> = {}): StockMovement {
  return {
    ulid: '01K62ZA1B2C3D4E5F6G7H8J9K0',
    product_id: 9,
    type: 'adjustment',
    qty_delta: 24,
    qty_before: 26,
    qty_after: 50,
    reason: 'Delivery from supplier',
    occurred_at: '2026-09-25T02:00:00Z',
    created_by: { id: 2, name: 'Marco Manager' },
    ...overrides,
  };
}

type ScPwdLine = {
  id: number;
  product_id: number;
  name: string;
  qty: number;
  unit: number;
  vatable: boolean;
  E: number;
  R: number;
  S: number;
  total: number;
  sc_pwd: boolean;
};

function scPwdItems(lines: readonly ScPwdLine[]): Order['items'] {
  return lines.map((entry) => ({
    id: entry.id,
    product_id: entry.product_id,
    product_name: entry.name,
    category_id: 2,
    category_name: 'Meals',
    sku: null,
    qty: entry.qty,
    unit_price_cents: entry.unit,
    gross_cents: entry.unit * entry.qty,
    is_vatable: entry.vatable,
    discount: null,
    line_discount_cents: 0,
    order_discount_share_cents: 0,
    line_total_cents: entry.total,
    notes: null,
    refunded_qty: 0,
    refunded_cents: 0,
    sc_pwd: entry.sc_pwd,
    sc_pwd_eligible_cents: entry.E,
    sc_pwd_vat_relief_cents: entry.R,
    sc_pwd_discount_cents: entry.S,
  }));
}

/**
 * Senior Citizen / PWD Discount, worked example D (`items` mode, one senior,
 * `vat_exempt: true`), or example F (`vatExempt: false`), paid in cash
 * (₱500.00 tendered), as the server returns it.
 */
export function makeScPwdOrder(vatExempt = true, overrides: Partial<Order> = {}): Order {
  const lines: ScPwdLine[] = vatExempt
    ? [
        { id: 201, product_id: 21, name: 'Meal', qty: 1, unit: 25000, vatable: true, E: 25000, R: 2679, S: 4464, total: 17857, sc_pwd: true },
        { id: 202, product_id: 22, name: 'Iced Tea', qty: 1, unit: 4500, vatable: true, E: 4500, R: 482, S: 804, total: 3214, sc_pwd: true },
        { id: 203, product_id: 21, name: 'Meal', qty: 1, unit: 25000, vatable: true, E: 0, R: 0, S: 0, total: 25000, sc_pwd: false },
      ]
    : [
        { id: 201, product_id: 21, name: 'Meal', qty: 1, unit: 25000, vatable: true, E: 25000, R: 0, S: 5000, total: 20000, sc_pwd: true },
        { id: 202, product_id: 22, name: 'Iced Tea', qty: 1, unit: 4500, vatable: true, E: 4500, R: 0, S: 900, total: 3600, sc_pwd: true },
        { id: 203, product_id: 21, name: 'Meal', qty: 1, unit: 25000, vatable: true, E: 0, R: 0, S: 0, total: 25000, sc_pwd: false },
      ];
  const total = vatExempt ? 46071 : 48600;
  return makeOrder({
    ulid: '01K6SCPWD0000000000000000D',
    invoice_no: 'INV-MAIN-00000050',
    queue_no: 21,
    customer: null,
    subtotal_cents: 54500,
    line_discounts_cents: 0,
    order_discount: null,
    discount_cents: 54500 - total,
    total_cents: total,
    vatable_sales_cents: vatExempt ? 22321 : 43393,
    vat_amount_cents: vatExempt ? 2679 : 5207,
    vat_exempt_sales_cents: vatExempt ? 21071 : 0,
    tendered_cents: 50000,
    change_cents: 50000 - total,
    client_total_cents: total,
    items: scPwdItems(lines),
    payments: [{ method: 'cash', amount_cents: total, tendered_cents: 50000, change_cents: 50000 - total, reference_no: null }],
    sc_pwd: {
      mode: 'items',
      persons: [{ type: 'senior_citizen', id_no: 'OSCA-12345' }],
      diners: null,
      vat_exempt: vatExempt,
      vat_relief_cents: vatExempt ? 3161 : 0,
      discount_cents: vatExempt ? 5268 : 5900,
    },
    ...overrides,
  });
}

/** Senior Citizen / PWD Discount, worked example E (`headcount` mode, 4 diners, 1 senior, `vat_exempt: true`), paid in cash. */
export function makeSharedMealOrder(overrides: Partial<Order> = {}): Order {
  return makeOrder({
    ulid: '01K6SCPWD0000000000000000E',
    invoice_no: 'INV-MAIN-00000051',
    queue_no: 22,
    customer: null,
    subtotal_cents: 110000,
    line_discounts_cents: 0,
    order_discount: null,
    discount_cents: 7729,
    total_cents: 102271,
    vatable_sales_cents: 69643,
    vat_amount_cents: 8357,
    vat_exempt_sales_cents: 24271,
    tendered_cents: 102271,
    change_cents: 0,
    client_total_cents: 102271,
    items: scPwdItems([
      { id: 301, product_id: 31, name: 'Platter', qty: 1, unit: 80000, vatable: true, E: 20000, R: 2143, S: 3572, total: 74285, sc_pwd: true },
      { id: 302, product_id: 32, name: 'Soda', qty: 2, unit: 12000, vatable: true, E: 6000, R: 643, S: 1071, total: 22286, sc_pwd: true },
      { id: 303, product_id: 33, name: 'Rice cake', qty: 1, unit: 6000, vatable: false, E: 1500, R: 0, S: 300, total: 5700, sc_pwd: true },
    ]),
    payments: [{ method: 'cash', amount_cents: 102271, tendered_cents: 102271, change_cents: 0, reference_no: null }],
    sc_pwd: {
      mode: 'headcount',
      persons: [{ type: 'senior_citizen', id_no: 'OSCA-12345' }],
      diners: 4,
      vat_exempt: true,
      vat_relief_cents: 2786,
      discount_cents: 4943,
    },
    ...overrides,
  });
}
