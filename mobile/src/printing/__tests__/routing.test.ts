/**
 * Routing (docs/api-contract.md → Printing → Routing): this tablet's receipt
 * printer, receipt copies, and one ticket per station with the default
 * kitchen printer as the fallback.
 */
import { chooseReceiptPrinter, planSale, routeKitchen, stationFor } from '@/printing/routing';
import { BAR, COUNTER, KITCHEN, makePrintConfig, makePrinter, makeSettings } from '@/test-utils/printing';
import { makeOrder } from '@/test-utils/sale';

const FRONT = makePrinter({ id: 4, name: 'Front', role: 'cashier', port: 9103 });
const ANNEX = makePrinter({ id: 5, name: 'Annex', role: 'cashier', port: 9104 });

describe('receipt printer', () => {
  it("uses this tablet's choice when it is an enabled cashier printer", () => {
    expect(chooseReceiptPrinter([COUNTER, FRONT, KITCHEN], 4)).toBe(FRONT);
  });

  it('falls back to the only enabled cashier printer, then the first by name', () => {
    expect(chooseReceiptPrinter([COUNTER, KITCHEN], null)).toBe(COUNTER);
    expect(chooseReceiptPrinter([COUNTER, KITCHEN], 99)).toBe(COUNTER);
    expect(chooseReceiptPrinter([FRONT, COUNTER, ANNEX], null)).toBe(ANNEX);
    // A choice that is now disabled, or no longer a cashier printer, falls back too.
    expect(chooseReceiptPrinter([{ ...FRONT, is_enabled: false }, COUNTER], 4)).toBe(COUNTER);
    expect(chooseReceiptPrinter([KITCHEN, COUNTER], KITCHEN.id)).toBe(COUNTER);
  });

  it('is null with no enabled cashier printer', () => {
    expect(chooseReceiptPrinter([KITCHEN, BAR, { ...COUNTER, is_enabled: false }], null)).toBeNull();
  });
});

describe('kitchen and bar', () => {
  it('worked example B with the dev seed: Hot Dog and Rice Cake to Kitchen, Iced Tea to Bar', () => {
    const routing = routeKitchen(makeOrder(), makePrintConfig());
    expect(routing.tickets.map((ticket) => [ticket.printer.name, ticket.items.map((item) => item.product_name)])).toEqual([
      ['Bar', ['Iced Tea']],
      ['Kitchen', ['Hot Dog', 'Rice Cake']],
    ]);
    expect(routing.unrouted).toEqual([]);
  });

  it("uses the category's printer only while it is enabled, then the enabled default kitchen printer", () => {
    expect(stationFor({ category_id: 3 }, [BAR, KITCHEN])).toBe(BAR);
    expect(stationFor({ category_id: 3 }, [{ ...BAR, is_enabled: false }, KITCHEN])).toBe(KITCHEN);
    expect(stationFor({ category_id: 99 }, [BAR, KITCHEN])).toBe(KITCHEN);
  });

  it('lists items as not sent to any printer when no enabled printer takes them', () => {
    const config = makePrintConfig({ printers: [COUNTER, { ...KITCHEN, is_enabled: false }, BAR] });
    const routing = routeKitchen(makeOrder(), config);
    expect(routing.tickets.map((ticket) => ticket.printer.name)).toEqual(['Bar']);
    expect(routing.unrouted.map((item) => item.product_name)).toEqual(['Hot Dog', 'Rice Cake']);
  });

  it('prints no tickets (and lists nothing) when kitchen tickets are off', () => {
    const routing = routeKitchen(makeOrder(), makePrintConfig({ settings: makeSettings({ print_kitchen_tickets: false }) }));
    expect(routing).toEqual({ tickets: [], unrouted: [] });
  });

  it('a manual reprint routes normally even when kitchen tickets are off (Q-007)', () => {
    const config = makePrintConfig({ settings: makeSettings({ print_kitchen_tickets: false }) });
    const routing = routeKitchen(makeOrder(), config, { manual: true });
    expect(routing.tickets.map((ticket) => ticket.printer.name)).toEqual(['Bar', 'Kitchen']);
    expect(routing.unrouted).toEqual([]);
  });
});

describe('planSale', () => {
  it('auto-print on: receipt_copies receipts', () => {
    const plan = planSale(makeOrder(), makePrintConfig({ settings: makeSettings({ receipt_copies: 2 }) }), null);
    expect(plan.receiptPrinter).toBe(COUNTER);
    expect(plan.receiptCopies).toBe(2);
    expect(plan.manualReceipt).toBe(false);
    expect(plan.tickets).toHaveLength(2);
  });

  it('auto-print off: no receipt now, a "Print receipt" button instead', () => {
    const plan = planSale(makeOrder(), makePrintConfig({ settings: makeSettings({ auto_print_receipt: false }) }), null);
    expect(plan.receiptCopies).toBe(0);
    expect(plan.manualReceipt).toBe(true);
  });

  it('no receipt printer: no receipt jobs', () => {
    const plan = planSale(makeOrder(), makePrintConfig({ printers: [KITCHEN, BAR] }), null);
    expect(plan.receiptPrinter).toBeNull();
    expect(plan.receiptCopies).toBe(0);
  });
});
