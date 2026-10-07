/**
 * Test-only fixtures for Shifts & Reporting (Phase 6), shaped exactly like
 * the contract examples. Never import from app code.
 */
import { shifts } from '@/db/schema';
import type { LocalShift } from '@/db/shiftRepository';
import type { SalesReport, SalesReportRow, Shift, ShiftReport } from '@/services/types';
import { useShiftStore } from '@/stores/shift';

import { currentTestDatabase } from './database';
import { TEST_SHIFT_ULID } from './sale';

export { TEST_SHIFT_ULID };

/** The contract's `ShiftReport` example. */
export function makeShiftReport(overrides: Partial<ShiftReport> = {}): ShiftReport {
  return {
    orders_count: 42,
    items_sold: 97,
    gross_sales_cents: 1250000,
    discounts_cents: 25000,
    net_sales_cents: 1225000,
    vatable_sales_cents: 1000000,
    vat_amount_cents: 120000,
    vat_exempt_sales_cents: 105000,
    by_payment_method: [
      { method: 'cash', orders_count: 30, amount_cents: 700000 },
      { method: 'gcash', orders_count: 14, amount_cents: 525000 },
    ],
    cash_in_cents: 50000,
    cash_out_cents: 105000,
    expected_cash_cents: 845000,
    variance_cents: 0,
    by_cashier: [{ user_id: 3, name: 'Carla Cashier', orders_count: 30, net_sales_cents: 900000 }],
    needs_review_count: 0,
    voids_count: 0,
    voids_cents: 0,
    refunds_count: 0,
    refunds_cents: 0,
    refunds_by_method: [
      { method: 'cash', amount_cents: 0 },
      { method: 'gcash', amount_cents: 0 },
    ],
    net_after_refunds_cents: 1225000,
    sc_pwd_orders_count: 0,
    sc_pwd_vat_relief_cents: 0,
    sc_pwd_discount_cents: 0,
    ...overrides,
  };
}

/** The contract's `Shift` example (closed). */
export function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    ulid: TEST_SHIFT_ULID,
    status: 'closed',
    device: { id: 1, code: 'T01' },
    opened_at: '2026-09-26T00:02:00Z',
    opened_by: { id: 3, name: 'Carla Cashier' },
    opening_float_cents: 200000,
    closed_at: '2026-09-26T09:05:00Z',
    closed_by: { id: 2, name: 'Marco Manager' },
    counted_cash_cents: 845000,
    close_note: null,
    report: makeShiftReport(),
    flags: [],
    synced_at: '2026-09-26T09:05:03Z',
    ...overrides,
  };
}

/** A local open shift (as `@/db/shiftRepository` returns it). */
export function makeLocalShift(overrides: Partial<LocalShift> = {}): LocalShift {
  return {
    ulid: TEST_SHIFT_ULID,
    branchId: 1,
    status: 'open',
    openedAt: '2026-09-26T00:02:00Z',
    openedBy: { id: 3, name: 'Carla Cashier' },
    openingFloatCents: 200000,
    closedAt: null,
    closedBy: null,
    countedCashCents: null,
    closeNote: null,
    ...overrides,
  };
}

/**
 * Stores an open shift in the test database **as already synced** (no outbox
 * row, so the outbox counts don't change) and puts it in the shift store, so
 * the Sell screen and checkout can sell. Call after `freshTestDatabase()`.
 */
export function seedOpenShift(overrides: Partial<LocalShift> = {}): LocalShift {
  const shift = makeLocalShift(overrides);
  currentTestDatabase()
    .insert(shifts)
    .values({
      ulid: shift.ulid,
      branch_id: shift.branchId,
      status: shift.status,
      opened_at: shift.openedAt,
      opened_by_id: shift.openedBy.id,
      opened_by_name: shift.openedBy.name,
      opening_float_cents: shift.openingFloatCents,
      closed_at: shift.closedAt,
      closed_by_id: shift.closedBy?.id ?? null,
      closed_by_name: shift.closedBy?.name ?? null,
      counted_cash_cents: shift.countedCashCents,
      close_note: shift.closeNote,
      created_at: shift.openedAt,
      updated_at: shift.openedAt,
    })
    .run();
  useShiftStore.getState().reset();
  if (shift.status === 'open') useShiftStore.getState().setLoaded(shift.branchId, shift);
  return shift;
}

/** A sales report row. */
export function makeReportRow(overrides: Partial<SalesReportRow> = {}): SalesReportRow {
  return {
    key: '9',
    label: 'Iced Tea',
    orders_count: 120,
    qty: 310,
    gross_sales_cents: 1085000,
    discounts_cents: 5000,
    net_sales_cents: 1080000,
    refunds_cents: 3369,
    net_after_refunds_cents: 1076631,
    refunded_qty: 1,
    ...overrides,
  };
}

/** `GET /reports/sales` → `data`, as the contract example. */
export function makeSalesReport(overrides: Partial<SalesReport> = {}): SalesReport {
  return {
    from: '2026-09-01',
    to: '2026-09-26',
    group_by: 'product',
    totals: {
      orders_count: 812,
      items_sold: 2104,
      gross_sales_cents: 9000000,
      discounts_cents: 120000,
      net_sales_cents: 8880000,
      vat_amount_cents: 850000,
      voids_count: 2,
      voids_cents: 51400,
      refunds_count: 1,
      refunds_cents: 3369,
      net_after_refunds_cents: 8876631,
      sc_pwd_orders_count: 0,
      sc_pwd_vat_relief_cents: 0,
      sc_pwd_discount_cents: 0,
    },
    rows: [makeReportRow()],
    ...overrides,
  };
}
