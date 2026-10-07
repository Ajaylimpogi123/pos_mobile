/**
 * Test-only fixtures for Inventory (v1 completion), shaped exactly as the
 * contract's examples. Never import from app code.
 */
import type {
  InventoryItem,
  InventoryMovement,
  InventoryPage,
  InventoryReport,
  InventoryReportRow,
  InventorySummary,
} from '@/services/types';

import { page } from './catalog';

/** `InventoryItem` as the contract example (Iced Tea, 9 on hand, reorder at 10: low). */
export function makeInventoryItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    product_id: 9,
    name: 'Iced Tea',
    sku: 'DRK-001',
    category: { id: 3, name: 'Drinks' },
    image_url: null,
    is_available: true,
    qty: 9,
    reorder_level: 10,
    status: 'low',
    cost_cents: 1200,
    stock_value_cents: 10800,
    last_movement_at: '2026-09-27T05:10:00Z',
    ...overrides,
  };
}

export const SUMMARY: InventorySummary = { tracked: 24, low: 3, out: 1 };

/** A GET /api/v1/inventory page: the cursor envelope plus `meta.summary`. */
export function inventoryPage(
  items: InventoryItem[],
  nextCursor: string | null = null,
  summary: InventorySummary = SUMMARY,
): InventoryPage {
  const base = page(items, nextCursor, '/api/v1/inventory');
  return { ...base, meta: { ...base.meta, summary } };
}

/** A movement history item as the contract example (a stock in of 24). */
export function makeInventoryMovement(overrides: Partial<InventoryMovement> = {}): InventoryMovement {
  return {
    ulid: '01K6RECEIPT00000000000001',
    type: 'receipt',
    qty_delta: 24,
    qty_after: 33,
    unit_cost_cents: 1200,
    reason: 'Delivery',
    occurred_at: '2026-09-27T02:00:00Z',
    created_by: { id: 2, name: 'Marco Manager' },
    reference: null,
    ...overrides,
  };
}

/** A report row as the contract example (its invariant holds: 35 + 24 − 50 + 1 − 1 + 0 = 9). */
export function makeInventoryReportRow(overrides: Partial<InventoryReportRow> = {}): InventoryReportRow {
  return {
    product_id: 9,
    name: 'Iced Tea',
    category_name: 'Drinks',
    opening_qty: 35,
    received: 24,
    sold: 50,
    returned: 1,
    wasted: 1,
    adjusted: 0,
    closing_qty: 9,
    reorder_level: 10,
    status: 'low',
    unit_cost_cents: 1200,
    stock_value_cents: 10800,
    ...overrides,
  };
}

/** GET /api/v1/reports/inventory `data` as the contract example. */
export function makeInventoryReport(overrides: Partial<InventoryReport> = {}): InventoryReport {
  return {
    from: '2026-09-27',
    to: '2026-09-27',
    totals: { tracked: 24, low: 3, out: 1, stock_value_cents: 1250000, received: 48, sold: 97, returned: 2, wasted: 3, adjusted: -1 },
    rows: [makeInventoryReportRow()],
    ...overrides,
  };
}
