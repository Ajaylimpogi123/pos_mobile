/**
 * Dine-in Tables & Tabs §F (docs/api-contract.md): the round kitchen ticket,
 * the kitchen void for a cancel, the bill, and the receipt's service charge
 * and share lines.
 */
import { billLines, billTotals, buildBill, splitLine } from '@pos/core/printing/documents/bill';
import { buildTabRoundTicket } from '@pos/core/printing/documents/kitchenTicket';
import { buildTabKitchenVoid } from '@pos/core/printing/documents/kitchenVoid';
import { buildReceipt, receiptShares } from '@pos/core/printing/documents/receipt';
import { routeTicketLines } from '@pos/core/printing/routing';
import { decodeEscPos, printedLines } from '@/test-utils/escpos';
import { BAR, COUNTER, KITCHEN, makeSettings } from '@/test-utils/printing';
import { makeOrder } from '@/test-utils/sale';
import { makeTab, makeTabItem } from '@/test-utils/tabs';

const TZ = 'Asia/Manila';
const settings = makeSettings();

describe('round kitchen ticket', () => {
  it('TABLE in double size, ROUND n · g guests, the server, the round items only', () => {
    const tab = makeTab();
    const round2 = tab.items.filter((item) => item.round_no === 2);
    const bytes = buildTabRoundTicket(tab, { printerName: 'Bar', items: round2, roundNo: 2, serverName: 'Cara', sentAt: '2026-10-13T10:05:00Z', columns: 32, timeZone: TZ });
    expect(printedLines(bytes)).toEqual(['BAR', 'TABLE 5', 'ROUND 2 · 3 guests', 'Server: Cara  6:05 PM', '-'.repeat(32), '3 x Iced Tea', '-'.repeat(32)]);
    expect(decodeEscPos(bytes)).toContain('[2x]TABLE 5');
  });

  it('routes a round like a sale, and not at all with print_kitchen_tickets off', () => {
    const tab = makeTab();
    const config = { printers: [COUNTER, KITCHEN, BAR], settings };
    const routed = routeTicketLines(tab.items, config);
    expect(routed.tickets.map((ticket) => [ticket.printer.name, ticket.items.map((item) => item.id)])).toEqual([
      ['Bar', [43]],
      ['Kitchen', [41, 42]],
    ]);
    expect(routeTicketLines(tab.items, { printers: config.printers, settings: makeSettings({ print_kitchen_tickets: false }) }).tickets).toEqual([]);
  });
});

describe('kitchen void for a cancel', () => {
  it('the VOID layout with the table and the cancelled quantity', () => {
    const lines = printedLines(
      buildTabKitchenVoid(makeTab(), { printerName: 'Kitchen', items: [{ ...makeTabItem(), qty: 1 }], cancelledAt: '2026-10-13T10:10:00Z', columns: 32, timeZone: TZ }),
    );
    expect(lines).toEqual(['KITCHEN', '*** VOID ***', 'TABLE 5', '6:10 PM', '-'.repeat(32), '1 x Sisig', '-'.repeat(32), 'Do not prepare']);
  });
});

describe('bill', () => {
  it('consolidates the remaining items by product and price', () => {
    const tab = makeTab({
      items: [
        makeTabItem({ id: 1, qty: 2 }),
        makeTabItem({ id: 2, round_no: 2, qty: 1 }),
        makeTabItem({ id: 3, round_no: 2, qty: 1, unit_price_cents: 25000 }),
        makeTabItem({ id: 4, round_no: 2, qty: 1, cancelled_qty: 1 }),
      ],
    });
    expect(billLines(tab).map((line) => [line.qty, line.unit_price_cents, line.amount_cents])).toEqual([
      [3, 22500, 67500],
      [1, 25000, 25000],
    ]);
    expect(billTotals(tab, 1000)).toEqual({ subtotal_cents: 92500, service_charge_cents: 9250, total_cents: 101750 });
  });

  it('prints the header, title, table, items, service charge, total and the split line', () => {
    const lines = printedLines(
      buildBill(makeTab(), { settings, columns: 32, timeZone: TZ, printedAt: Date.parse('2026-10-13T11:42:00Z'), serviceChargeBps: 1000, splitCount: 3 }),
    );
    expect(lines).toEqual([
      'Main Branch',
      '123 Rizal St., Makati',
      'TIN 000-123-456-000',
      'BILL - NOT A RECEIPT',
      'Table      5',
      'Guests     3',
      'Time       10/13/2026 7:42 PM',
      '-'.repeat(32),
      '1 x Hot Dog                80.00',
      '2 x Rice Cake              90.00',
      '  @45.00',
      '3 x Iced Tea              105.00',
      '  @35.00',
      '-'.repeat(32),
      'Subtotal                  275.00',
      'Service charge (10%)       27.50',
      'TOTAL                    P302.50',
      'Split 3 ways: P100.84 / P100.83',
      '/ P100.83',
    ]);
    expect(splitLine(90000, 3)).toBe('Split 3 ways: ₱300.00 each');
  });
});

describe('receipt additions', () => {
  it('a Service charge row before the total, and one share line per receipt', () => {
    const order = makeOrder({ service_charge_cents: 2570, total_cents: 28270, split_count: 3, tab_ulid: 'T' });
    const shares = receiptShares(order);
    expect(shares.map((share) => share.amountCents)).toEqual([9424, 9423, 9423]);
    const lines = printedLines(buildReceipt(order, { settings, columns: 32, timeZone: TZ, serviceChargeBps: 1000, share: shares[0] }));
    const total = lines.indexOf('TOTAL                    P282.70');
    expect(lines[total - 1]).toBe('Service charge (10%)       25.70');
    expect(lines).toContain('Share 1 of 3 · P94.24 · GCash');
    expect(receiptShares(makeOrder())).toEqual([]);
  });
});
