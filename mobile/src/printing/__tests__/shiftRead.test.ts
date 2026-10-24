/**
 * The shift reports on paper (docs/api-contract.md → Shifts & Reporting →
 * Reports on the tablet): `x_read` and `z_read` at 32 and 48 columns, every
 * figure from the `ShiftReport`, nothing computed.
 */
import { buildShiftRead, type ShiftReadDocument } from '@pos/core/printing/documents/shiftRead';
import { jobLabel } from '@/printing/labels';
import { decodeEscPos, printedLines } from '@/test-utils/escpos';
import { makeShiftReport, TEST_SHIFT_ULID } from '@/test-utils/shifts';

function doc(overrides: Partial<ShiftReadDocument> = {}): ShiftReadDocument {
  return {
    kind: 'z_read',
    shift: {
      ulid: TEST_SHIFT_ULID,
      deviceCode: 'T01',
      openedAt: '2026-09-26T00:02:00Z',
      openedBy: { id: 3, name: 'Carla Cashier' },
      openingFloatCents: 200000,
      closedAt: '2026-09-26T09:05:00Z',
      closedBy: { id: 2, name: 'Marco Manager' },
      countedCashCents: 840000,
      closeNote: 'Paid the ice supplier from the drawer without a slip',
    },
    report: makeShiftReport({ variance_cents: -5000 }),
    printedAt: '2026-09-26T09:05:00Z',
    branchName: 'Main Branch',
    ...overrides,
  };
}

const TZ = 'Asia/Manila';

describe.each([32, 48])('at %i columns', (columns) => {
  it('the Z-read: header, times in branch time, sales, payments, the drawer with counted cash and variance, cashiers; every line fits', () => {
    const bytes = buildShiftRead(doc(), { columns, timeZone: TZ });
    const lines = printedLines(bytes);
    const text = lines.join('\n');

    for (const line of lines) expect(line.length).toBeLessThanOrEqual(columns);
    expect(decodeEscPos(bytes)).toContain('[2x]Z-READ');
    expect(text).toContain('SHIFT REPORT');
    // Wraps at 32 columns: compare with the line breaks folded to spaces.
    expect(lines.map((line) => line.trim()).join(' ')).toContain('Not a BIR reading');
    expect(text).toMatch(/Tablet\s+T01/);
    expect(text).toMatch(/Opened\s+09\/26\/2026 8:02 AM/);
    expect(text).toMatch(/Closed\s+09\/26\/2026 5:05 PM/);
    expect(text).toMatch(/Net sales\s+12,250\.00/);
    expect(text).toMatch(/Discounts\s+-250\.00/);
    expect(text).toMatch(/VAT 12%\s+1,200\.00/);
    expect(text).toMatch(/Cash \(30\)\s+7,000\.00/);
    expect(text).toMatch(/GCash \(14\)\s+5,250\.00/);
    expect(text).toMatch(/Opening float\s+2,000\.00/);
    expect(text).toMatch(/Cash out\s+-1,050\.00/);
    expect(text).toMatch(/Expected cash\s+8,450\.00/);
    expect(text).toMatch(/Counted cash\s+8,400\.00/);
    expect(text).toMatch(/Variance \(Short\)\s+-50\.00/);
    expect(text).toMatch(/Carla Cashier \(30\)\s+9,000\.00/);
    expect(text).toContain('Note: Paid the ice');
    expect(text).not.toContain('REPRINT');
    expect(decodeEscPos(bytes).endsWith('[CUT]')).toBe(true);
  });

  it('the X-read: printed time, no count and no variance while open; a reprint is marked', () => {
    const open = doc({
      kind: 'x_read',
      shift: { ...doc().shift, closedAt: null, closedBy: null, countedCashCents: null, closeNote: null },
      report: makeShiftReport({ variance_cents: null }),
      printedAt: '2026-09-26T03:30:00Z',
    });
    const text = printedLines(buildShiftRead(open, { columns, timeZone: TZ })).join('\n');
    expect(decodeEscPos(buildShiftRead(open, { columns, timeZone: TZ }))).toContain('[2x]X-READ');
    expect(text).toMatch(/Printed\s+09\/26\/2026 11:30 AM/);
    expect(text).not.toContain('Counted cash');
    expect(text).not.toContain('Variance');
    expect(text).not.toContain('Closed');

    const reprint = printedLines(buildShiftRead(doc(), { columns, timeZone: TZ, reprint: true })).join('\n');
    expect(reprint).toContain('*** REPRINT ***');
  });
});

it('labels the jobs "X-read", "Z-read" and "Z-read (reprint)"', () => {
  const base = { printerRole: 'cashier' as const, queueNo: 0, copyNo: 1, copies: 1 };
  expect(jobLabel({ ...base, kind: 'x_read', isReprint: false })).toBe('X-read');
  expect(jobLabel({ ...base, kind: 'z_read', isReprint: false })).toBe('Z-read');
  expect(jobLabel({ ...base, kind: 'z_read', isReprint: true })).toBe('Z-read (reprint)');
});
