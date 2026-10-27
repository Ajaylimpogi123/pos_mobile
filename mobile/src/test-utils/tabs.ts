/**
 * Dine-in Tables & Tabs fixtures, as the contract examples. The tab items
 * are worked example B's products (Hot Dog, Rice Cake, Iced Tea) so the
 * settlement can be checked against worked example K.
 */
import type { DiningTable, Tab, TabItem, TableView } from '@/services/types';

export const TAB_ULID = '01K7TAB0000000000000000001';

export function makeTabItem(overrides: Partial<TabItem> = {}): TabItem {
  const qty = overrides.qty ?? 1;
  const settled = overrides.settled_qty ?? 0;
  const cancelled = overrides.cancelled_qty ?? 0;
  return {
    id: 41,
    round_no: 1,
    product_id: 4,
    product_name: 'Sisig',
    category_id: 2,
    unit_price_cents: 22500,
    is_vatable: true,
    qty,
    settled_qty: settled,
    cancelled_qty: cancelled,
    remaining_qty: qty - settled - cancelled,
    notes: null,
    added_at: '2026-10-13T10:00:00Z',
    added_by: { id: 3, name: 'Cara' },
    ...overrides,
  };
}

/** Worked example B's lines as a tab: Hot Dog ×1 (round 1), Rice Cake ×2 (round 1), Iced Tea ×3 (round 2). */
export function exampleBItems(): TabItem[] {
  return [
    makeTabItem({ id: 41, round_no: 1, product_id: 1, product_name: 'Hot Dog', category_id: 1, unit_price_cents: 8000, qty: 1, notes: 'No ketchup' }),
    makeTabItem({ id: 42, round_no: 1, product_id: 2, product_name: 'Rice Cake', category_id: 2, unit_price_cents: 4500, is_vatable: false, qty: 2 }),
    makeTabItem({ id: 43, round_no: 2, product_id: 9, product_name: 'Iced Tea', category_id: 3, unit_price_cents: 3500, qty: 3 }),
  ];
}

export function makeTab(overrides: Partial<Tab> = {}): Tab {
  const items = overrides.items ?? exampleBItems();
  return {
    ulid: TAB_ULID,
    status: 'open',
    table: { id: 5, name: '5', area: 'Patio' },
    guests: 3,
    customer: null,
    notes: null,
    opened_at: '2026-10-13T10:00:00Z',
    opened_by: { id: 3, name: 'Cara' },
    closed_at: null,
    merged_into_ulid: null,
    rounds_count: Math.max(0, ...items.map((item) => item.round_no)),
    items,
    orders: [],
    remaining_cents: items.reduce((sum, item) => sum + item.unit_price_cents * item.remaining_qty, 0),
    updated_at: '2026-10-13T10:05:00Z',
    ...overrides,
  };
}

export function makeDiningTable(overrides: Partial<DiningTable> = {}): DiningTable {
  return {
    id: 5,
    name: '5',
    area: 'Patio',
    seats: 4,
    pos_x: null,
    pos_y: null,
    width: 2,
    height: 2,
    shape: 'rect',
    sort_order: 0,
    is_active: true,
    updated_at: '2026-10-13T09:00:00Z',
    ...overrides,
  };
}

export function makeTableView(overrides: Partial<TableView> = {}): TableView {
  return {
    id: 5,
    name: '5',
    area: 'Patio',
    seats: 4,
    pos_x: null,
    pos_y: null,
    width: 2,
    height: 2,
    shape: 'rect',
    tab: null,
    reservation: null,
    ...overrides,
  };
}
