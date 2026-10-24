/**
 * The Phase 7 print documents (docs/api-contract.md → Voids & Refunds →
 * Printing): the void slip, the VOID kitchen ticket, the refund slip, and
 * the X/Z-read's Voids / Refunds / Net after refunds and Cash refunds lines.
 * Every figure comes from the server's `Order` / `Refund` / `ShiftReport`.
 */
import { buildKitchenVoid, kitchenNumberOf } from '@pos/core/printing/documents/kitchenVoid';
import { buildRefundSlip } from '@pos/core/printing/documents/refundSlip';
import { buildShiftRead } from '@pos/core/printing/documents/shiftRead';
import { buildVoidSlip } from '@pos/core/printing/documents/voidSlip';
import { jobLabel } from '@/printing/labels';
import { decodeEscPos, printedLines } from '@/test-utils/escpos';
import { mockVatBreakdown } from '@/test-utils/features';
import { makeSettings } from '@/test-utils/printing';
import { makeOrder, makePartlyRefundedOrder, makeRefund, makeVoidedOrder } from '@/test-utils/sale';
import { makeShiftReport, TEST_SHIFT_ULID } from '@/test-utils/shifts';

const TZ = 'Asia/Manila';
const settings = makeSettings();

describe.each([32, 48])('at %i columns', (columns) => {
  afterEach(() => jest.restoreAllMocks());

  it('the void slip: *** VOID ***, sold and voided (branch time), approver, reason, the lines, TOTAL VOIDED and what to give back', () => {
    const bytes = buildVoidSlip(makeVoidedOrder(), { settings, columns, timeZone: TZ });
    const lines = printedLines(bytes);
    const text = lines.join('\n');
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(columns);

    expect(decodeEscPos(bytes)).toContain('[2x]*** VOID ***');
    expect(lines[0]).toBe('Main Branch');
    expect(text).toMatch(/No\.\s+INV-MAIN-00000042/);
    // Wraps at 32 columns: compare with the line breaks folded to spaces.
    const flat = lines.map((line) => line.trim()).join(' ');
    expect(flat).toMatch(/Sold\s+09\/25\/2026 12:12 PM · Carla Cashier/);
    expect(flat).toMatch(/Voided\s+09\/25\/2026 12:20 PM · Carla Cashier/);
    expect(text).toContain('Marco Manager');
    expect(text).toMatch(/Reason\s+Customer cancelled/);
    expect(text).toMatch(/1 x Hot Dog\s+80\.00/);
    expect(text).toMatch(/TOTAL VOIDED\s+P257\.00/);
    expect(text).toMatch(/Cash returned\s+157\.00/);
    expect(text).toMatch(/GCash to return\s+100\.00/);
    expect(text).toContain('Ref 1012345678901');
    expect(text).not.toContain('REPRINT');
    expect(decodeEscPos(bytes).endsWith('[CUT]')).toBe(true);

    const reprint = printedLines(buildVoidSlip(makeVoidedOrder(), { settings, columns, timeZone: TZ, reprint: true })).join('\n');
    expect(reprint).toContain('*** REPRINT ***');
  });

  it('no "Approved by" when the caller had sale.void', () => {
    const text = printedLines(buildVoidSlip(makeVoidedOrder({ void_authorized_by: null }), { settings, columns, timeZone: TZ })).join('\n');
    expect(text).not.toContain('Approved by');
  });

  it('the VOID kitchen ticket: printer name, *** VOID ***, the number, invoice and void time, the station\'s lines, no prices, Do not prepare', () => {
    const order = makeVoidedOrder();
    const bytes = buildKitchenVoid(order, { printerName: 'Kitchen', items: order.items.slice(0, 2), columns, timeZone: TZ });
    const lines = printedLines(bytes);
    const text = lines.join('\n');
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(columns);
    expect(lines.slice(0, 3)).toEqual(['KITCHEN', '*** VOID ***', '#17']);
    expect(text).toContain('INV-MAIN-00000042  12:20 PM');
    expect(text).toContain('1 x Hot Dog');
    expect(text).toContain('2 x Rice Cake');
    expect(text).not.toContain('Iced Tea');
    expect(text).not.toMatch(/\d+\.\d\d/);
    expect(lines[lines.length - 1]).toBe('Do not prepare');
  });

  it('the refund slip: REFUND, when and who, approver, reason, the refunded lines, TOTAL REFUND, the methods, the footer (no VAT split while SHOW_VAT_BREAKDOWN is off)', () => {
    const order = makePartlyRefundedOrder();
    const bytes = buildRefundSlip({ order, refund: order.refunds[0] }, { settings, columns, timeZone: TZ });
    const lines = printedLines(bytes);
    const text = lines.join('\n');
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(columns);
    expect(decodeEscPos(bytes)).toContain('[2x]REFUND');
    expect(text).toMatch(/No\.\s+INV-MAIN-00000042/);
    const flat = lines.map((line) => line.trim()).join(' ');
    expect(flat).toMatch(/Refunded\s+09\/27\/2026 1:10 PM · Carla Cashier/);
    expect(flat).toContain('Approved by Marco Manager');
    expect(text).toMatch(/Reason\s+Wrong drink/);
    expect(text).toMatch(/1 x Iced Tea\s+33\.69/);
    expect(text).toMatch(/TOTAL REFUND\s+P33\.69/);
    expect(text).toMatch(/Cash\s+33\.69/);
    expect(text).not.toMatch(/VAT/);
    expect(lines.slice(-2)).toEqual(['-'.repeat(columns), 'This is not an official receipt.']);
  });

  it('the refund slip with SHOW_VAT_BREAKDOWN on: the VAT split before the footer', () => {
    mockVatBreakdown(true);
    const order = makePartlyRefundedOrder();
    const text = printedLines(buildRefundSlip({ order, refund: order.refunds[0] }, { settings, columns, timeZone: TZ })).join('\n');
    expect(text).toMatch(/VATable sales\s+30\.08/);
    expect(text).toMatch(/VAT 12%\s+3\.61/);
    expect(text).toMatch(/VAT-exempt sales\s+0\.00\nThis is not an official receipt\./);
  });

  it('the refund slip with VAT hidden and no footer lines: no trailing separator', () => {
    const order = makePartlyRefundedOrder();
    const lines = printedLines(
      buildRefundSlip({ order, refund: order.refunds[0] }, { settings: makeSettings({ receipt_footer_lines: [] }), columns, timeZone: TZ }),
    );
    expect(lines[lines.length - 1]).toMatch(/^Cash\s+33\.69$/);
  });

  it('a GCash refund prints its reference', () => {
    const refund = makeRefund({ payments: [{ method: 'gcash', amount_cents: 3369, reference_no: '9988' }] });
    const text = printedLines(buildRefundSlip({ order: makeOrder(), refund }, { settings, columns, timeZone: TZ })).join('\n');
    expect(text).toMatch(/GCash 9988\s+33\.69/);
  });

  it('the X/Z-read: Voids (N), Refunds (N), Net after refunds after the sales; Cash refunds before Expected cash', () => {
    const report = makeShiftReport({
      voids_count: 2,
      voids_cents: 51400,
      refunds_count: 1,
      refunds_cents: 3369,
      refunds_by_method: [
        { method: 'cash', amount_cents: 3369 },
        { method: 'gcash', amount_cents: 0 },
      ],
      net_after_refunds_cents: 1221631,
      expected_cash_cents: 841631,
    });
    const bytes = buildShiftRead(
      {
        kind: 'x_read',
        shift: {
          ulid: TEST_SHIFT_ULID,
          deviceCode: 'T01',
          openedAt: '2026-09-26T00:02:00Z',
          openedBy: { id: 3, name: 'Carla Cashier' },
          openingFloatCents: 200000,
          closedAt: null,
          closedBy: null,
          countedCashCents: null,
          closeNote: null,
        },
        report,
        printedAt: '2026-09-26T03:00:00Z',
        branchName: 'Main Branch',
      },
      { columns, timeZone: TZ },
    );
    const lines = printedLines(bytes);
    const text = lines.join('\n');
    expect(text).toMatch(/Voids \(2\)\s+514\.00/);
    expect(text).toMatch(/Refunds \(1\)\s+33\.69/);
    expect(text).toMatch(/Net after refunds\s+12,216\.31/);
    expect(text).toMatch(/Cash refunds\s+-33\.69/);
    const index = (pattern: RegExp) => lines.findIndex((line) => pattern.test(line));
    expect(index(/^VAT-exempt sales/)).toBeLessThan(index(/^Voids/));
    expect(index(/^Net after refunds/)).toBeLessThan(index(/^PAYMENTS/));
    expect(index(/^Cash out/)).toBeLessThan(index(/^Cash refunds/));
    expect(index(/^Cash refunds/)).toBeLessThan(index(/^Expected cash/));
    expect(decodeEscPos(bytes)).toContain('[BOLD]Net after refunds');
  });
});

it('the kitchen number of an offline sale is its T01-5, as its ticket showed', () => {
  expect(kitchenNumberOf(makeOrder())).toBe('#17');
  expect(kitchenNumberOf(makeOrder({ source: 'offline', order_no: 'T01-20260926-0005' }))).toBe('T01-5');
});

it('job labels for the new kinds', () => {
  const base = { printerRole: 'cashier' as const, queueNo: 17, copyNo: 1, copies: 1, isReprint: false };
  expect(jobLabel({ ...base, kind: 'void_slip' })).toBe('Void slip #17');
  expect(jobLabel({ ...base, kind: 'refund_slip', isReprint: true })).toBe('Refund slip #17 (reprint)');
  expect(jobLabel({ ...base, kind: 'kitchen_void', printerRole: 'bar' })).toBe('VOID bar ticket #17');
  expect(jobLabel({ ...base, kind: 'kitchen_void', printerRole: 'kitchen' })).toBe('VOID kitchen ticket #17');
});
