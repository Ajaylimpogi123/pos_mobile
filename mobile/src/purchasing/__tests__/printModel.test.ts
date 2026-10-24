/**
 * Purchase Request & Order PDF (v1.24 §C–§E, v1.27 §G): `@pos/core/purchasing/printModel`,
 * the document rules shared by the web print pages and the tablet's HTML.
 */
import { makePoLine, makePrItem, makePurchaseOrder } from '@/test-utils/purchasing';
import {
  commonApprover,
  groupLinesBySupplier,
  itemEstimateCents,
  parseSupplierParam,
  poDate,
  prEstimateTotals,
  PRINT_FORBIDDEN_MESSAGE,
  printErrorProps,
  printFooterText,
  selectSupplierGroups,
  showReceivedColumns,
} from '@pos/core/purchasing/printModel';

const bakery = { id: 7, name: 'Bakery Supply Co' };

describe('purchase request estimates (§C)', () => {
  it('rounds price × qty half up, and has no estimate without a price', () => {
    expect(itemEstimateCents(makePrItem({ estimated_unit_price_cents: 333, qty: '1.500' }))).toBe(500);
    expect(itemEstimateCents(makePrItem({ estimated_unit_price_cents: null }))).toBeNull();
  });

  it('totals all items, the approved ones, and counts the unpriced', () => {
    const totals = prEstimateTotals([
      makePrItem({ id: 1, decision: 'approved' }),
      makePrItem({ id: 2, decision: 'declined', estimated_unit_price_cents: 1000, qty: '3.000' }),
      makePrItem({ id: 3, estimated_unit_price_cents: null }),
    ]);
    expect(totals).toEqual({ totalCents: 243000, approvedCents: 240000, unpricedCount: 1 });
  });

  it('has no total when no item has a price', () => {
    expect(prEstimateTotals([makePrItem({ estimated_unit_price_cents: null })]).totalCents).toBeNull();
  });

  it('names the approver only when one person decided every decided item', () => {
    const ana = { id: 2, name: 'Ana' };
    const ben = { id: 5, name: 'Ben' };
    expect(commonApprover([makePrItem({ decision: 'approved', decided_by: ana }), makePrItem({ decision: 'declined', decided_by: ana }), makePrItem()])).toEqual(ana);
    expect(commonApprover([makePrItem({ decision: 'approved', decided_by: ana }), makePrItem({ decision: 'approved', decided_by: ben })])).toBeNull();
    expect(commonApprover([makePrItem()])).toBeNull();
  });
});

describe('purchase order grouping (§D)', () => {
  const po = makePurchaseOrder({
    total_cents: 300000,
    lines: [makePoLine({ id: 1 }), makePoLine({ id: 2, supplier: bakery, line_total_cents: 50000 }), makePoLine({ id: 3, line_total_cents: 10000 })],
  });

  it('groups the lines by supplier in first-seen order with subtotals', () => {
    const groups = groupLinesBySupplier(po.lines);
    expect(groups.map((group) => [group.supplier.id, group.lines.map((line) => line.id), group.subtotalCents])).toEqual([
      [4, [1, 3], 250000],
      [7, [2], 50000],
    ]);
  });

  it('selects all suppliers or one, with that supplier’s subtotal as the total', () => {
    expect(selectSupplierGroups(po, null)).toMatchObject({ only: null, totalCents: 300000 });
    const one = selectSupplierGroups(po, 7);
    expect(one.only).toEqual(bakery);
    expect(one.totalCents).toBe(50000);
    expect(one.groups).toHaveLength(1);
    expect(selectSupplierGroups(po, 99).only).toBeNull();
  });

  it('parses the supplier param', () => {
    expect(parseSupplierParam('7')).toBe(7);
    expect(parseSupplierParam('0')).toBeNull();
    expect(parseSupplierParam('x')).toBeNull();
    expect(parseSupplierParam(null)).toBeNull();
  });

  it('hides Received / Remaining until something was received', () => {
    expect(showReceivedColumns(makePurchaseOrder())).toBe(false);
    expect(showReceivedColumns(makePurchaseOrder({ receiving_status: 'partially_received' }))).toBe(true);
  });

  it('dates the PO from its earliest timeline entry', () => {
    const dated = makePurchaseOrder({
      timeline: [
        { at: '2026-09-29T02:00:00Z', action: 'po.approved', by: null, details: null },
        { at: '2026-09-28T02:00:00Z', action: 'po.created', by: null, details: null },
      ],
    });
    expect(poDate(dated)).toBe('2026-09-28T02:00:00Z');
    expect(poDate(makePurchaseOrder({ timeline: [] }))).toBeNull();
  });
});

describe('states and footer (§B, §E)', () => {
  it('words 404 and 403 without Retry, and other errors with it', () => {
    const retry = jest.fn();
    expect(printErrorProps(404, 'x', 'This order was not found.', retry)).toEqual({ message: 'This order was not found.' });
    expect(printErrorProps(403, 'x', 'n', retry)).toEqual({ message: PRINT_FORBIDDEN_MESSAGE });
    expect(printErrorProps(500, 'Server error', 'n', retry)).toEqual({ message: 'Server error', onRetry: retry });
  });

  it('builds the footer text', () => {
    expect(printFooterText('12 Oct 2026, 3:04 PM', 'Ana', 'PR-MAIN-2026-00003')).toBe('Printed 12 Oct 2026, 3:04 PM by Ana · PR-MAIN-2026-00003');
    expect(printFooterText('12 Oct 2026, 3:04 PM', '', 'PO-1')).toBe('Printed 12 Oct 2026, 3:04 PM · PO-1');
  });
});
