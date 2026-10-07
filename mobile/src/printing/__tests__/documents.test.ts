/**
 * The printed documents (docs/api-contract.md → Printing → Receipt layout,
 * Kitchen ticket, Test page), for worked example B at 32 and 48 columns,
 * decoded by the test-utils decoder. The documents print the server's
 * `Order` fields and never compute money.
 */
import { buildKitchenTicket, mergeTicketLines } from '@/printing/documents/kitchenTicket';
import { buildReceipt, buildReceiptSample } from '@/printing/documents/receipt';
import { buildTestPage, columnRuler } from '@/printing/documents/testPage';
import { decodeEscPos, printedLines } from '@/test-utils/escpos';
import { mockVatBreakdown } from '@/test-utils/features';
import { makeSettings } from '@/test-utils/printing';
import { makeOrder } from '@/test-utils/sale';

const TZ = 'Asia/Manila';
const settings = makeSettings();

describe('receipt', () => {
  afterEach(() => jest.restoreAllMocks());

  it('worked example B at 32 columns (58 mm): no VAT lines while SHOW_VAT_BREAKDOWN is off', () => {
    expect(printedLines(buildReceipt(makeOrder(), { settings, columns: 32, timeZone: TZ }))).toEqual([
      'Main Branch',
      '123 Rizal St., Makati',
      'TIN 000-123-456-000',
      'SALES RECEIPT',
      'No.        INV-MAIN-00000042',
      'Date       09/25/2026 12:12 PM',
      'Cashier    Carla Cashier',
      'Customer   Maria Santos',
      'QUEUE #17',
      '--------------------------------',
      '1 x Hot Dog                80.00',
      '  Promo 10%                -8.00',
      '2 x Rice Cake              90.00',
      '  @45.00',
      '3 x Iced Tea              105.00',
      '  @35.00',
      '--------------------------------',
      'Subtotal                  275.00',
      'Order discount (Promo)    -10.00',
      'TOTAL                    P257.00',
      'GCash 1012345678901       100.00',
      'Cash                      200.00',
      'Change                     43.00',
      '--------------------------------',
      'This is not an official receipt.',
    ]);
  });

  it('worked example B at 48 columns (80 mm), with SHOW_VAT_BREAKDOWN on: the VAT-exempt detail and the VAT breakdown', () => {
    mockVatBreakdown(true);
    expect(printedLines(buildReceipt(makeOrder(), { settings, columns: 48, timeZone: TZ }))).toEqual([
      'Main Branch',
      '123 Rizal St., Makati',
      'TIN 000-123-456-000',
      'SALES RECEIPT',
      'No.        INV-MAIN-00000042',
      'Date       09/25/2026 12:12 PM',
      'Cashier    Carla Cashier',
      'Customer   Maria Santos',
      'QUEUE #17',
      '------------------------------------------------',
      '1 x Hot Dog                                80.00',
      '  Promo 10%                                -8.00',
      '2 x Rice Cake                              90.00',
      '  @45.00 VAT-exempt',
      '3 x Iced Tea                              105.00',
      '  @35.00',
      '------------------------------------------------',
      'Subtotal                                  275.00',
      'Order discount (Promo)                    -10.00',
      'TOTAL                                    P257.00',
      'GCash 1012345678901                       100.00',
      'Cash                                      200.00',
      'Change                                     43.00',
      '------------------------------------------------',
      'VATable sales                             152.12',
      'VAT 12%                                    18.25',
      'VAT-exempt sales                           86.63',
      'This is not an official receipt.',
    ]);
  });

  it('with VAT hidden and nothing after the change (no footer), no trailing separator', () => {
    const lines = printedLines(
      buildReceipt(makeOrder(), { settings: makeSettings({ receipt_footer_lines: [] }), columns: 32, timeZone: TZ }),
    );
    expect(lines[lines.length - 1]).toBe('Change                     43.00');
  });

  it('styles: first header line bold and centred, the queue number double size, the total bold double height, then a cut', () => {
    const text = decodeEscPos(buildReceipt(makeOrder(), { settings, columns: 32, timeZone: TZ }));
    expect(text.startsWith('[INIT][KANJI OFF][CP0][CENTER][BOLD]Main Branch\n[/BOLD]123 Rizal')).toBe(true);
    expect(text).toContain('[CENTER][2x]QUEUE #17\n[1x][LEFT]');
    expect(text).toContain('[BOLD][2h]TOTAL                    P257.00\n[1x][/BOLD]');
    expect(text).toContain('[CENTER]This is not an official receipt.\n[LEFT]');
    expect(text.endsWith('[FEED 3][CUT]')).toBe(true);
  });

  it('marks reprints, numbers copies, names the approver, and leaves out an empty customer', () => {
    const order = makeOrder({ customer: null, authorized_by: { id: 2, name: 'Marco Manager' } });
    const lines = printedLines(buildReceipt(order, { settings, columns: 32, timeZone: TZ, reprint: true, copy: { number: 2, of: 2 } }));
    expect(lines.slice(3, 5)).toEqual(['SALES RECEIPT', '*** REPRINT ***']);
    expect(lines.some((line) => line.startsWith('Customer'))).toBe(false);
    expect(lines).toContain('Discount approved by Marco');
    expect(lines).toContain('Manager');
    expect(lines[lines.length - 1]).toBe('Copy 2 of 2');

    const single = printedLines(buildReceipt(order, { settings, columns: 32, timeZone: TZ, copy: { number: 1, of: 1 } }));
    expect(single.some((line) => line.startsWith('Copy'))).toBe(false);
  });

  it('prints a percent order discount with its rate, and a GCash-only sale without a cash row', () => {
    const order = makeOrder({
      order_discount: { type: 'employee', kind: 'percent', value: 500, amount_cents: 1285 },
      payments: [{ method: 'gcash', amount_cents: 25700, tendered_cents: null, change_cents: 0, reference_no: '555' }],
      change_cents: 0,
    });
    const lines = printedLines(buildReceipt(order, { settings, columns: 32, timeZone: TZ }));
    // The label wraps beside the amount (the discount comes from the server's `amount_cents`).
    expect(lines).toContain('Order discount (Employee  -12.85');
    expect(lines).toContain('  5%)');
    expect(lines).toContain('GCash 555                 257.00');
    expect(lines.some((line) => line.startsWith('Cash '))).toBe(false);
    expect(lines).toContain('Change                      0.00');
  });

  it('strips control characters from names and header lines', () => {
    const order = makeOrder({ cashier: { id: 3, name: 'Carla\u001b@Cashier' } });
    const receipt = buildReceipt(order, { settings: makeSettings({ receipt_header_lines: ['Main\u001dV\u0001 Branch'] }), columns: 32, timeZone: TZ });
    const lines = printedLines(receipt);
    expect(lines[0]).toBe('MainV Branch');
    expect(lines).toContain('Cashier    Carla@Cashier');
  });

  it('prints a sample with the header and footer lines only (no invented sale)', () => {
    const lines = printedLines(buildReceiptSample(settings, { columns: 32, timeZone: TZ, now: Date.parse('2026-09-25T04:12:09Z') }));
    expect(lines).toEqual([
      'Main Branch',
      '123 Rizal St., Makati',
      'TIN 000-123-456-000',
      'SALES RECEIPT',
      '*** SAMPLE ***',
      'Date       09/25/2026 12:12 PM',
      '--------------------------------',
      'Sale details print here.',
      '--------------------------------',
      'This is not an official receipt.',
    ]);
  });
});

describe('kitchen ticket', () => {
  const kitchenItems = makeOrder().items.filter((item) => item.category_id !== 3);

  it('worked example B, the Kitchen station, at 32 and 48 columns: no prices, bold double-height lines, notes', () => {
    for (const columns of [32, 48]) {
      const lines = printedLines(buildKitchenTicket(makeOrder(), { printerName: 'Kitchen', items: kitchenItems, columns, timeZone: TZ }));
      expect(lines).toEqual([
        'KITCHEN',
        '#17',
        'INV-MAIN-00000042  12:12 PM',
        'Cashier: Carla Cashier',
        '-'.repeat(columns),
        '1 x Hot Dog',
        '  > No ketchup',
        '2 x Rice Cake',
        '-'.repeat(columns),
      ]);
    }
    const text = decodeEscPos(buildKitchenTicket(makeOrder(), { printerName: 'Kitchen', items: kitchenItems, columns: 32, timeZone: TZ }));
    expect(text).toContain('[CENTER][BOLD]KITCHEN\n[/BOLD]');
    expect(text).toContain('[CENTER][2x]#17\n[1x][LEFT]');
    expect(text).toContain('[BOLD][2h]2 x Rice Cake\n[1x][/BOLD]');
    expect(text).not.toMatch(/\d+\.\d\d/);
  });

  it('marks reprints and prints the order note', () => {
    const lines = printedLines(
      buildKitchenTicket(makeOrder({ notes: 'Table 4, rush' }), { printerName: 'Bar', items: makeOrder().items.slice(2), columns: 32, timeZone: TZ, reprint: true }),
    );
    expect(lines.slice(0, 3)).toEqual(['BAR', '*** REPRINT ***', '#17']);
    expect(lines).toContain('3 x Iced Tea');
    expect(lines[lines.length - 1]).toBe('Note: Table 4, rush');
  });

  it('merges lines with the same product and notes, keeping the order of sale', () => {
    const [hotDog, riceCake] = makeOrder().items;
    const merged = mergeTicketLines([
      hotDog,
      riceCake,
      { ...hotDog, id: 104, qty: 2 },
      { ...hotDog, id: 105, qty: 1, notes: null },
      { ...riceCake, id: 106, qty: 1, notes: '  ' },
    ]);
    expect(merged).toEqual([
      { product_id: 4, product_name: 'Hot Dog', qty: 3, notes: 'No ketchup' },
      { product_id: 11, product_name: 'Rice Cake', qty: 3, notes: null },
      { product_id: 4, product_name: 'Hot Dog', qty: 1, notes: null },
    ]);
  });
});

describe('table number (Core Sale revision 2)', () => {
  const order = makeOrder({ table_no: '12' });
  const kitchenItems = order.items.filter((item) => item.category_id !== 3);

  it('receipt: a "Table" row right after the QUEUE line, at 32 and 48 columns', () => {
    for (const columns of [32, 48]) {
      const lines = printedLines(buildReceipt(order, { settings, columns, timeZone: TZ }));
      const queue = lines.indexOf('QUEUE #17');
      expect(lines.slice(queue, queue + 3)).toEqual(['QUEUE #17', 'Table      12', '-'.repeat(columns)]);
    }
  });

  it('kitchen ticket: "TABLE 12" centred in double size, right under the queue number, at 32 and 48 columns', () => {
    for (const columns of [32, 48]) {
      const ticket = buildKitchenTicket(order, { printerName: 'Kitchen', items: kitchenItems, columns, timeZone: TZ });
      expect(printedLines(ticket).slice(0, 4)).toEqual(['KITCHEN', '#17', 'TABLE 12', 'INV-MAIN-00000042  12:12 PM']);
      expect(decodeEscPos(ticket)).toContain('[CENTER][2x]#17\nTABLE 12\n[1x][LEFT]');
    }
  });

  it('prints nothing for the table when it is null', () => {
    const receipt = printedLines(buildReceipt(makeOrder(), { settings, columns: 32, timeZone: TZ }));
    const ticket = printedLines(buildKitchenTicket(makeOrder(), { printerName: 'Kitchen', items: kitchenItems, columns: 32, timeZone: TZ }));
    expect(receipt.some((line) => line.startsWith('Table'))).toBe(false);
    expect(ticket.some((line) => line.startsWith('TABLE'))).toBe(false);
  });

  it('strips control characters from the table too', () => {
    const lines = printedLines(
      buildKitchenTicket(makeOrder({ table_no: 'A\u001b@3' }), { printerName: 'Kitchen', items: kitchenItems, columns: 32, timeZone: TZ }),
    );
    expect(lines[2]).toBe('TABLE A@3');
  });
});

describe('test page', () => {
  it('shows the printer, a column ruler, the code-page sample and the time', () => {
    const page = buildTestPage(
      { name: 'Kitchen', role: 'kitchen', host: '192.168.1.60', port: 9101, paper_width_mm: 58 },
      { timeZone: TZ, now: Date.parse('2026-09-25T04:12:09Z') },
    );
    expect(printedLines(page)).toEqual([
      'TEST PRINT',
      'Printer  Kitchen',
      'Role     Kitchen',
      'Address  192.168.1.60:9101',
      'Paper    58 mm, 32 columns',
      '--------------------------------',
      '         1         2         3',
      '12345678901234567890123456789012',
      '--------------------------------',
      'Niño Peña é P',
      'Time     09/25/2026 12:12 PM',
    ]);
    // ñ and é are CP437 bytes, ₱ became P.
    expect(Array.from(page)).toEqual(expect.arrayContaining([0xa4, 0x82]));
  });

  it('has a 48-column ruler at 80 mm', () => {
    expect(columnRuler(48)[1]).toHaveLength(48);
    expect(columnRuler(48)[0]).toBe('         1         2         3         4');
  });
});
