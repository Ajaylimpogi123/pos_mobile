/**
 * What the screens call (docs/api-contract.md → Printing): the first print of
 * a sale (receipts and one ticket per station, deduplicated), reprints (never
 * deduplicated), startup recovery, the "unavailable" build, and the rule that
 * printing never throws into the sale flow.
 */
import { INTERRUPTED_MESSAGE, printRepository } from '@/db/printRepository';
import {
  CONFIG_NOT_SYNCED_MESSAGE,
  NO_CONFIG_MESSAGE,
  printSale,
  reprintOrder,
  resetPrintingForTests,
  retryJob,
  startPrinting,
  testPrint,
  whenPrintQueueIdle,
} from '@/printing/printActions';
import { createUnavailableTransport, EXPO_GO_MESSAGE, getPrintTransport } from '@/printing/transport';
import { usePrintingStore } from '@/stores/printing';
import { freshTestDatabase } from '@/test-utils/database';
import { printedLines } from '@/test-utils/escpos';
import { BAR, createFakeTransport, KITCHEN, makePrintConfig, makeSettings, type FakeTransport } from '@/test-utils/printing';
import { makeOrder } from '@/test-utils/sale';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

jest.mock('@/printing/transport', () => {
  const actual = jest.requireActual<typeof import('@/printing/transport')>('@/printing/transport');
  return { ...actual, getPrintTransport: jest.fn(actual.getPrintTransport) };
});

const getTransport = getPrintTransport as jest.Mock;
let fake: FakeTransport;

async function jobsOf(ulid: string) {
  return printRepository.jobsForOrder(ulid);
}

beforeEach(async () => {
  await freshTestDatabase();
  resetPrintingForTests();
  usePrintingStore.getState().reset();
  usePrintingStore.getState().setConfig(makePrintConfig());
  fake = createFakeTransport();
  getTransport.mockReturnValue(fake.transport);
});

describe('printSale', () => {
  it('prints worked example B: a receipt to Counter, and one ticket each to Bar and Kitchen', async () => {
    await printSale(makeOrder());
    await whenPrintQueueIdle();

    expect(fake.sentTo(9100)).toHaveLength(1);
    expect(printedLines(fake.sentTo(9100)[0].bytes)).toContain('SALES RECEIPT');
    expect(printedLines(fake.sentTo(9101)[0].bytes).slice(0, 2)).toEqual(['KITCHEN', '#17']);
    expect(printedLines(fake.sentTo(9102)[0].bytes)).toContain('3 x Iced Tea');

    const summary = usePrintingStore.getState().sales[makeOrder().ulid];
    expect(summary).toMatchObject({ preparing: false, notice: null, noReceiptPrinter: false, manualReceipt: false, unrouted: [] });
    expect(summary.jobIds).toHaveLength(3);
    expect(summary.jobIds.map((id) => usePrintingStore.getState().jobs[id].status)).toEqual(['sent', 'sent', 'sent']);
  });

  it('never prints a sale twice (a replayed 201 or the Q-004 lookup)', async () => {
    await printSale(makeOrder());
    await whenPrintQueueIdle();
    await printSale(makeOrder());
    await whenPrintQueueIdle();
    expect(fake.sent).toHaveLength(3);
    expect(await jobsOf(makeOrder().ulid)).toHaveLength(3);
    expect(usePrintingStore.getState().sales[makeOrder().ulid].jobIds).toHaveLength(3);
  });

  it('prints receipt_copies receipts, numbered', async () => {
    usePrintingStore.getState().setConfig(makePrintConfig({ settings: makeSettings({ receipt_copies: 2 }) }));
    await printSale(makeOrder());
    await whenPrintQueueIdle();
    const receipts = fake.sentTo(9100).map((document) => printedLines(document.bytes));
    expect(receipts.map((lines) => lines[lines.length - 1])).toEqual(['Copy 1 of 2', 'Copy 2 of 2']);
  });

  it('lists items no printer takes, says when there is no receipt printer, and offers "Print receipt" when auto-print is off', async () => {
    usePrintingStore.getState().setConfig(makePrintConfig({ printers: [BAR] }));
    await printSale(makeOrder());
    expect(usePrintingStore.getState().sales[makeOrder().ulid]).toMatchObject({
      noReceiptPrinter: true,
      unrouted: ['1 x Hot Dog', '2 x Rice Cake'],
    });

    usePrintingStore.getState().setConfig(makePrintConfig({ settings: makeSettings({ auto_print_receipt: false }) }));
    const order = makeOrder({ ulid: '01K62Z3K5Q9V7X2M4N6P8R0T2X' });
    await printSale(order);
    expect(usePrintingStore.getState().sales[order.ulid]).toMatchObject({ manualReceipt: true, noReceiptPrinter: false });
  });

  it('queues nothing in a build that can\'t print (Expo Go), and says why', async () => {
    getTransport.mockReturnValue(createUnavailableTransport(EXPO_GO_MESSAGE));
    await printSale(makeOrder());
    expect(usePrintingStore.getState().sales[makeOrder().ulid]).toMatchObject({ notice: EXPO_GO_MESSAGE, jobIds: [] });
    expect(await jobsOf(makeOrder().ulid)).toEqual([]);
  });

  it('never throws into the sale flow: no config yet, or a storage failure, only sets a notice', async () => {
    usePrintingStore.getState().setConfig(null);
    await expect(printSale(makeOrder())).resolves.toBeUndefined();
    expect(usePrintingStore.getState().sales[makeOrder().ulid].notice).toBe(NO_CONFIG_MESSAGE);

    usePrintingStore.getState().setConfig(makePrintConfig());
    jest.spyOn(printRepository, 'insertJobs').mockRejectedValueOnce(new Error('disk full'));
    await expect(printSale(makeOrder())).resolves.toBeUndefined();
    expect(usePrintingStore.getState().sales[makeOrder().ulid].notice).toMatch(/Reprint it from Orders/);
  });
});

describe('reprints', () => {
  it('are never deduplicated and print "*** REPRINT ***"', async () => {
    await printSale(makeOrder());
    await whenPrintQueueIdle();
    const first = await reprintOrder(makeOrder(), 'receipt');
    const second = await reprintOrder(makeOrder(), 'receipt');
    await whenPrintQueueIdle();
    expect(first.jobIds).toHaveLength(1);
    expect(second.jobIds).toHaveLength(1);
    const reprints = fake.sentTo(9100).slice(1).map((document) => printedLines(document.bytes));
    expect(reprints).toHaveLength(2);
    for (const lines of reprints) expect(lines).toContain('*** REPRINT ***');
  });

  it('kitchen: every station, even with automatic kitchen tickets off (Q-007)', async () => {
    const result = await reprintOrder(makeOrder(), 'kitchen');
    await whenPrintQueueIdle();
    expect(result.jobIds).toHaveLength(2);
    expect(printedLines(fake.sentTo(9101)[0].bytes)[1]).toBe('*** REPRINT ***');

    // The setting governs automatic printing only: the sale prints no tickets, a manual reprint still does.
    usePrintingStore.getState().setConfig(makePrintConfig({ settings: makeSettings({ print_kitchen_tickets: false }) }));
    const order = makeOrder({ ulid: '01K62Z3K5Q9V7X2M4N6P8R0T3Y' });
    await printSale(order);
    await whenPrintQueueIdle();
    expect((await jobsOf(order.ulid)).map((job) => job.kind)).toEqual(['receipt']);
    const manual = await reprintOrder(order, 'kitchen');
    await whenPrintQueueIdle();
    expect(manual).toMatchObject({ notice: null, unrouted: [] });
    expect(manual.jobIds).toHaveLength(2);
    expect(fake.sentTo(9101)).toHaveLength(2);
    expect(fake.sentTo(9102)).toHaveLength(2);
    usePrintingStore.getState().setConfig(null);
    expect((await reprintOrder(makeOrder(), 'receipt')).notice).toBe(CONFIG_NOT_SYNCED_MESSAGE);
  });
});

describe('startup and retry', () => {
  it('startPrinting fails interrupted jobs (never reprinted silently) and loads them for the Sell banner', async () => {
    const ids = await printRepository.insertJobs([
      {
        id: '01K62Z0000000000000000000A',
        order_ulid: makeOrder().ulid,
        queue_no: 17,
        kind: 'kitchen',
        printer_id: KITCHEN.id,
        printer_name: 'Kitchen',
        printer_role: 'kitchen',
        copy_no: 1,
        copies: 1,
        is_reprint: false,
        order_json: JSON.stringify(makeOrder()),
        item_ids: '[101,102]',
        status: 'printing',
        attempts: 1,
        error: null,
        dismissed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
    expect(await startPrinting()).toBe(true);
    expect(usePrintingStore.getState().jobs[ids[0]]).toMatchObject({ status: 'failed', error: INTERRUPTED_MESSAGE });
    expect(fake.sent).toHaveLength(0);

    await retryJob(ids[0]);
    await whenPrintQueueIdle();
    expect(usePrintingStore.getState().jobs[ids[0]]).toMatchObject({ status: 'sent', error: null });
    expect(fake.sentTo(9101)).toHaveLength(1);
  });

  it('a write error fails the job with the contract message, and Retry sends it again', async () => {
    fake.fail(9100, 'write', 1);
    await printSale(makeOrder());
    await whenPrintQueueIdle();
    const [receiptId] = usePrintingStore.getState().sales[makeOrder().ulid].jobIds;
    expect(usePrintingStore.getState().jobs[receiptId]).toMatchObject({
      status: 'failed',
      error: 'Counter may have printed part of this. Check before retrying.',
    });
    await retryJob(receiptId);
    await whenPrintQueueIdle();
    expect(usePrintingStore.getState().jobs[receiptId].status).toBe('sent');
  });
});

describe('testPrint', () => {
  it('sends the test page to the address given (saved or not), and reports a failure', async () => {
    const ok = await testPrint({ name: 'New', role: 'kitchen', host: '192.168.1.77', port: 9105, paper_width_mm: 58 });
    expect(ok).toEqual({ ok: true, message: 'Test page sent to New. Check that it printed.' });
    expect(fake.sent[0].target).toEqual({ host: '192.168.1.77', port: 9105 });
    expect(printedLines(fake.sent[0].bytes)[0]).toBe('TEST PRINT');

    fake.fail(9101, 'timeout');
    expect(await testPrint(KITCHEN)).toEqual({ ok: false, message: "Kitchen isn't responding." });
  });
});
