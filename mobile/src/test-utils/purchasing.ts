/**
 * Test-only fixtures for Ingredients, Recipes & Purchasing (Round A), shaped
 * as the contract (docs/api-contract.md §A–§I, worked examples G–I). Never
 * import from app code.
 */
import type {
  AuthUser,
  Ingredient,
  IngredientMovement,
  IngredientStockAdjustmentResult,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseRequest,
  PurchaseRequestItem,
  PurchasingReport,
  Supplier,
  Unit,
} from '@/services/types';

import { managerUser } from './catalog';
import { cashierUser } from './index';

/** §A unit catalog, exactly the contract's table (factors as decimal strings, Q-025). */
export const UNIT_CATALOG: Unit[] = [
  { code: 'mg', name: 'Milligram', dimension: 'mass', factor_to_base: '0.001' },
  { code: 'g', name: 'Gram', dimension: 'mass', factor_to_base: '1' },
  { code: 'kg', name: 'Kilogram', dimension: 'mass', factor_to_base: '1000' },
  { code: 'oz', name: 'Ounce', dimension: 'mass', factor_to_base: '28.349523125' },
  { code: 'lb', name: 'Pound', dimension: 'mass', factor_to_base: '453.59237' },
  { code: 'mL', name: 'Milliliter', dimension: 'volume', factor_to_base: '1' },
  { code: 'L', name: 'Liter', dimension: 'volume', factor_to_base: '1000' },
  { code: 'tsp', name: 'Teaspoon', dimension: 'volume', factor_to_base: '4.92892159375' },
  { code: 'tbsp', name: 'Tablespoon', dimension: 'volume', factor_to_base: '14.78676478125' },
  { code: 'fl oz', name: 'Fluid ounce', dimension: 'volume', factor_to_base: '29.5735295625' },
  { code: 'cup', name: 'Cup (US)', dimension: 'volume', factor_to_base: '236.5882365' },
  { code: 'pt', name: 'Pint', dimension: 'volume', factor_to_base: '473.176473' },
  { code: 'qt', name: 'Quart', dimension: 'volume', factor_to_base: '946.352946' },
  { code: 'gal', name: 'Gallon', dimension: 'volume', factor_to_base: '3785.411784' },
  { code: 'pc', name: 'Piece', dimension: 'count', factor_to_base: '1' },
  { code: 'dozen', name: 'Dozen', dimension: 'count', factor_to_base: '12' },
  { code: 'half dozen', name: 'Half dozen', dimension: 'count', factor_to_base: '6' },
];

/** The manager per §E (purchase.request, purchase.approve, purchase.receive, supplier.manage; no approve_own). */
export const purchasingManager: AuthUser = managerUser;

/** The owner: every purchase permission, including `purchase.approve_own`. */
export const ownerUser: AuthUser = {
  ...managerUser,
  id: 1,
  name: 'Olivia Owner',
  role: { id: 1, slug: 'owner', name: 'Owner', max_discount_percent: 100, is_admin: true },
  permissions: [...managerUser.permissions, 'purchase.approve_own'],
};

/** A cashier granted `purchase.request` only (§E "grantable"). */
export const requesterCashier: AuthUser = { ...cashierUser, permissions: [...cashierUser.permissions, 'purchase.request'] };

/** Flour (g) with its own units `sack` = 25000 and `cup` = 120 (§A), 30,000 g at avg 4.666667 (example H). */
export function makeIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: 5,
    name: 'Flour',
    base_unit: 'g',
    // Q-025: in use (it has movements), so the base unit is locked.
    base_unit_locked: true,
    image_url: null,
    image_path: null,
    is_active: true,
    units: [
      { id: 11, name: 'sack', factor: '25000.0000000000' },
      { id: 12, name: 'cup', factor: '120.0000000000' },
    ],
    qty: '30000.000',
    reorder_level: '5000.000',
    status: 'in_stock',
    avg_cost: '4.666667',
    stock_value_cents: 140000,
    last_movement_at: '2026-09-27T02:00:00Z',
    ...overrides,
  };
}

/** Milk (mL), no own units. */
export function makeMilk(overrides: Partial<Ingredient> = {}): Ingredient {
  return makeIngredient({ id: 6, name: 'Milk', base_unit: 'mL', units: [], qty: '2000.000', reorder_level: null, avg_cost: '9.500000', stock_value_cents: 19000, ...overrides });
}

export function makeIngredientMovement(overrides: Partial<IngredientMovement> = {}): IngredientMovement {
  return {
    ulid: '01K6RCPT00000000000000000A',
    type: 'receipt',
    qty_delta: '25000.000',
    qty_after: '30000.000',
    entered_qty: '1.000',
    entered_unit: 'sack',
    unit_cost_cents: 120000,
    value_cents: 120000,
    reason: null,
    occurred_at: '2026-09-27T02:00:00Z',
    created_by: { id: 2, name: 'Mia Manager' },
    reference: { kind: 'purchase_order', ulid: '01K6PZ0000000000000000000A', label: 'PO-MAIN-2026-00001' },
    ...overrides,
  };
}

/** The 201 of an ingredient stock adjustment (Q-026): the movement item plus `ingredient_id`, `qty_before`, `qty_after`. */
export function makeIngredientAdjustment(overrides: Partial<IngredientStockAdjustmentResult> = {}): IngredientStockAdjustmentResult {
  return {
    ...makeIngredientMovement({ ulid: '01K6ADJ0000000000000000000', type: 'wastage', qty_delta: '-240.000', qty_after: '29760.000', entered_qty: '2.000', entered_unit: 'cup', unit_cost_cents: null, value_cents: -1120, reason: 'Spoiled', reference: null }),
    ingredient_id: 5,
    qty_before: '30000.000',
    ...overrides,
  };
}

export function makeSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: 4,
    name: 'Golden Mills Trading',
    contact_person: 'Ana Reyes',
    contact_number: '0917 123 4567',
    email: 'orders@goldenmills.test',
    address: '12 Rizal St, Bacolod',
    is_active: true,
    ...overrides,
  };
}

export const PR_ULID = '01K6PR0000000000000000000A';
export const PO_ULID = '01K6PZ0000000000000000000A';

export function makePrItem(overrides: Partial<PurchaseRequestItem> = {}): PurchaseRequestItem {
  return {
    id: 31,
    item: { type: 'ingredient', id: 5, name: 'Flour' },
    supplier: { id: 4, name: 'Golden Mills Trading' },
    qty: '2.000',
    unit: 'sack',
    base_qty: '50000.000',
    estimated_unit_price_cents: 120000,
    remarks: null,
    decision: 'pending',
    decision_reason: null,
    decided_by: null,
    decided_at: null,
    ...overrides,
  };
}

/** A pending PR by the cashier (id 3), with Flour and Eggs. */
export function makePurchaseRequest(overrides: Partial<PurchaseRequest> = {}): PurchaseRequest {
  return {
    ulid: PR_ULID,
    pr_no: 'PR-MAIN-2026-00001',
    status: 'pending_approval',
    requested_by: { id: 3, name: 'Carla Cashier' },
    date_needed: '2026-10-01',
    remarks: 'For the weekend',
    created_at: '2026-09-28T01:00:00Z',
    items: [
      makePrItem(),
      // Q-027: product quantities are integers.
      makePrItem({ id: 32, item: { type: 'product', id: 9, name: 'Iced Tea' }, qty: 24, unit: 'pc', base_qty: 24, estimated_unit_price_cents: null }),
    ],
    purchase_order: null,
    timeline: [{ at: '2026-09-28T01:00:00Z', action: 'pr.created', by: { id: 3, name: 'Carla Cashier' }, details: null }],
    ...overrides,
  };
}

/** Example I's line: Flour 2 sack @ 120000 → 240000, nothing received yet. */
export function makePoLine(overrides: Partial<PurchaseOrderLine> = {}): PurchaseOrderLine {
  return {
    id: 41,
    item: { type: 'ingredient', id: 5, name: 'Flour' },
    supplier: { id: 4, name: 'Golden Mills Trading' },
    qty: '2.000',
    unit: 'sack',
    base_qty: '50000.000',
    unit_price_cents: 120000,
    line_total_cents: 240000,
    received_base_qty: '0.000',
    received_qty: '0.000',
    remaining_qty: '2.000',
    receiving_status: 'pending',
    ...overrides,
  };
}

export function makePurchaseOrder(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    ulid: PO_ULID,
    po_no: 'PO-MAIN-2026-00001',
    status: 'pending_approval',
    receiving_status: 'not_received',
    purchase_request: { ulid: PR_ULID, pr_no: 'PR-MAIN-2026-00001' },
    created_by: { id: 2, name: 'Mia Manager' },
    approved_by: null,
    approved_at: null,
    decline_reason: null,
    expected_delivery_date: null,
    remarks: null,
    total_cents: 240000,
    lines: [makePoLine()],
    receipts: [],
    timeline: [{ at: '2026-09-28T02:00:00Z', action: 'po.created', by: { id: 2, name: 'Mia Manager' }, details: null }],
    ...overrides,
  };
}

export function makePurchasingReport(overrides: Partial<PurchasingReport> = {}): PurchasingReport {
  return {
    from: '2026-09-28',
    to: '2026-09-28',
    totals: {
      prs: 1,
      items: 2,
      approved: 1,
      declined: 1,
      pending: 0,
      pos: { pending_approval: 0, approved: 1, declined: 0 },
      ordered_cents: 240000,
      received_cents: 120000,
      remaining_cents: 120000,
    },
    rows: [
      {
        pr_no: 'PR-MAIN-2026-00001',
        pr_date: '2026-09-28',
        requested_by: 'Carla Cashier',
        item_name: 'Flour',
        supplier_name: 'Golden Mills Trading',
        requested_qty: '2.000',
        unit: 'sack',
        decision: 'approved',
        decision_reason: null,
        decided_by: 'Mia Manager',
        po_no: 'PO-MAIN-2026-00001',
        po_status: 'approved',
        ordered_qty: '2.000',
        received_qty: '1.000',
        remaining_qty: '1.000',
        line_receiving_status: 'partial',
        unit_price_cents: 120000,
        ordered_cents: 240000,
        received_cents: 120000,
        last_received_at: '2026-09-28T05:00:00Z',
      },
      {
        pr_no: 'PR-MAIN-2026-00001',
        pr_date: '2026-09-28',
        requested_by: 'Carla Cashier',
        item_name: 'Iced Tea',
        supplier_name: 'Golden Mills Trading',
        requested_qty: '24.000',
        unit: 'pc',
        decision: 'declined',
        decision_reason: 'Enough stock',
        decided_by: 'Mia Manager',
        po_no: null,
        po_status: null,
        ordered_qty: null,
        received_qty: null,
        remaining_qty: null,
        line_receiving_status: null,
        unit_price_cents: null,
        ordered_cents: null,
        received_cents: null,
        last_received_at: null,
      },
    ],
    ...overrides,
  };
}
