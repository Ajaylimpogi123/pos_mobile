/**
 * SC/PWD on paper (docs/api-contract.md → Senior Citizen / PWD Discount →
 * Device rules → Receipt, and Reports → X/Z-read): the `  SC/PWD` marker,
 * `VAT exempted (SC/PWD)` only when `vat_exempt`, `SC/PWD discount 20%`, one
 * ID line per person, the shared-meal line and the signature line; every
 * figure from the `Order` / `ShiftReport`.
 */
import { buildReceipt } from '@pos/core/printing/documents/receipt';
import { buildShiftRead } from '@pos/core/printing/documents/shiftRead';
import { buildVoidSlip } from '@pos/core/printing/documents/voidSlip';
import { printedLines } from '@/test-utils/escpos';
import { mockVatBreakdown } from '@/test-utils/features';
import { makeSettings } from '@/test-utils/printing';
import { makeOrder, makeScPwdOrder, makeSharedMealOrder } from '@/test-utils/sale';
import { makeShiftReport, TEST_SHIFT_ULID } from '@/test-utils/shifts';

const TZ = 'Asia/Manila';
const settings = makeSettings();

function receipt(order: Parameters<typeof buildReceipt>[0], columns = 32): string[] {
  return printedLines(buildReceipt(order, { settings, columns, timeZone: TZ }));
}

describe('receipt', () => {
  afterEach(() => jest.restoreAllMocks());

  it('items mode, VAT exempt (example D) at 32 columns: the VAT exempted deduction stays, the VAT breakdown is hidden (SHOW_VAT_BREAKDOWN off)', () => {
    expect(receipt(makeScPwdOrder(true))).toEqual([
      'Main Branch',
      '123 Rizal St., Makati',
      'TIN 000-123-456-000',
      'SALES RECEIPT',
      'No.        INV-MAIN-00000050',
      'Date       09/25/2026 12:12 PM',
      'Cashier    Carla Cashier',
      'QUEUE #21',
      '--------------------------------',
      '1 x Meal                  250.00',
      '  SC/PWD',
      '1 x Iced Tea               45.00',
      '  SC/PWD',
      '1 x Meal                  250.00',
      '--------------------------------',
      'Subtotal                  545.00',
      'VAT exempted (SC/PWD)     -31.61',
      'SC/PWD discount 20%       -52.68',
      'TOTAL                    P460.71',
      'Cash                      500.00',
      'Change                     39.29',
      '--------------------------------',
      'Senior citizen  ID OSCA-12345',
      'Signature: ____________________',
      'This is not an official receipt.',
    ]);
  });

  it('items mode, not VAT exempt (example F): no "VAT exempted" row, the discount only', () => {
    const lines = receipt(makeScPwdOrder(false));
    expect(lines.some((line) => line.startsWith('VAT exempted'))).toBe(false);
    expect(lines).toContain('SC/PWD discount 20%       -59.00');
    expect(lines).toContain('TOTAL                    P486.00');
    expect(lines.some((line) => line.startsWith('VATable sales') || line.startsWith('VAT-exempt sales'))).toBe(false);
    expect(lines).toContain('Signature: ____________________');
  });

  it('headcount mode (example E) at 48 columns, SHOW_VAT_BREAKDOWN on: every line with a share is marked, the shared-meal line, a wider signature', () => {
    mockVatBreakdown(true);
    const lines = receipt(makeSharedMealOrder(), 48);
    const start = lines.indexOf('1 x Platter                               800.00');
    expect(lines.slice(start, start + 8)).toEqual([
      '1 x Platter                               800.00',
      '  SC/PWD',
      '2 x Soda                                  240.00',
      '  @120.00',
      '  SC/PWD',
      '1 x Rice cake                              60.00',
      '  VAT-exempt',
      '  SC/PWD',
    ]);
    expect(lines).toContain('VAT exempted (SC/PWD)                     -27.86');
    expect(lines).toContain('SC/PWD discount 20%                       -49.43');
    expect(lines).toContain('VAT-exempt sales                          242.71');
    const end = lines.indexOf('This is not an official receipt.');
    expect(lines.slice(end - 3, end)).toEqual([
      'Senior citizen  ID OSCA-12345',
      'Shared by 4 diners, 1 SC/PWD',
      `Signature: ${'_'.repeat(36)}`,
    ]);
  });

  it('one ID line per person ("PWD" for a PWD); a sale without SC/PWD prints none of it', () => {
    const base = makeSharedMealOrder();
    const two = makeSharedMealOrder({
      sc_pwd: base.sc_pwd && { ...base.sc_pwd, persons: [...base.sc_pwd.persons, { type: 'pwd', id_no: 'PWD-0099' }] },
    });
    const lines = receipt(two);
    expect(lines).toContain('Senior citizen  ID OSCA-12345');
    expect(lines).toContain('PWD             ID PWD-0099');
    expect(lines).toContain('Shared by 4 diners, 2 SC/PWD');

    const plain = receipt(makeOrder()).join('\n');
    expect(plain).not.toContain('SC/PWD');
    expect(plain).not.toContain('Signature');
  });

  it('an order stored before SC/PWD (no sc_pwd fields) still prints', () => {
    const legacy = makeOrder();
    const stripped = { ...legacy, sc_pwd: undefined, items: legacy.items.map((item) => ({ ...item, sc_pwd: undefined })) } as unknown as typeof legacy;
    expect(receipt(stripped).join('\n')).not.toContain('SC/PWD');
  });
});

describe('void slip', () => {
  it('prints the SC/PWD rows after the lines, so they add up to TOTAL VOIDED (as agreed in Q-023)', () => {
    const order = { ...makeScPwdOrder(true), status: 'voided' as const, voided_at: '2026-09-25T04:20:00Z', voided_by: { id: 3, name: 'Carla Cashier' }, void_reason: 'Wrong order' };
    const lines = printedLines(buildVoidSlip(order, { settings, columns: 32, timeZone: TZ }));
    const start = lines.indexOf('1 x Meal                  250.00');
    expect(lines.slice(start)).toEqual([
      '1 x Meal                  250.00',
      '  SC/PWD',
      '1 x Iced Tea               45.00',
      '  SC/PWD',
      '1 x Meal                  250.00',
      'VAT exempted (SC/PWD)     -31.61',
      'SC/PWD discount 20%       -52.68',
      'TOTAL VOIDED             P460.71',
      'Cash returned'.padEnd(26) + '460.71',
    ]);
  });
});

describe('X/Z-read (layout as agreed in Q-023)', () => {
  function read(report = makeShiftReport()) {
    return printedLines(
      buildShiftRead(
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
          printedAt: '2026-09-26T05:00:00Z',
          branchName: 'Main Branch',
        },
        { columns: 32, timeZone: TZ },
      ),
    );
  }

  it('after Discounts: SC/PWD (N), VAT exempted (when not 0) and SC/PWD discount', () => {
    const lines = read(makeShiftReport({ sc_pwd_orders_count: 2, sc_pwd_vat_relief_cents: 5947, sc_pwd_discount_cents: 10211 }));
    const at = lines.findIndex((line) => line.startsWith('Discounts'));
    expect(lines.slice(at, at + 5)).toEqual([
      'Discounts                -250.00',
      '  SC/PWD (2)',
      '  VAT exempted            -59.47',
      '  SC/PWD discount        -102.11',
      'Net sales              12,250.00',
    ]);
  });

  it('with no SC/PWD sale: SC/PWD (0) and a 0.00 discount, no VAT exempted line', () => {
    const lines = read();
    const at = lines.findIndex((line) => line.startsWith('Discounts'));
    expect(lines.slice(at + 1, at + 3)).toEqual(['  SC/PWD (0)', '  SC/PWD discount           0.00']);
    expect(lines.some((line) => line.includes('VAT exempted'))).toBe(false);
  });
});
