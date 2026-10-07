/**
 * The print queue (docs/api-contract.md → Printing → Queue) against a real
 * in-memory SQLite `print_jobs` table, a fake transport and an injected
 * sleep: backoff timing, no automatic retry after a write error, the lane
 * breaker, lanes in parallel, first-print dedupe, startup recovery, pruning,
 * and host/port read from the current config at send time.
 */
import { INTERRUPTED_MESSAGE, printRepository } from '@/db/printRepository';
import type { PrintJobInsert } from '@/db/schema';
import { createPrintQueue, type PrintQueue } from '@/printing/queue';
import { renderJob } from '@/printing/render';
import type { Order, PrintConfig, Printer } from '@/services/types';
import { freshTestDatabase } from '@/test-utils/database';
import { printedLines } from '@/test-utils/escpos';
import { COUNTER, createFakeTransport, KITCHEN, makePrintConfig, type FakeTransport } from '@/test-utils/printing';
import { makeOrder } from '@/test-utils/sale';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

let fake: FakeTransport;
let config: PrintConfig;
let sleep: jest.Mock;
let queue: PrintQueue;
let jobNumber = 0;

function job(printer: Printer, overrides: Partial<PrintJobInsert> = {}, order: Order = makeOrder()): PrintJobInsert {
  jobNumber += 1;
  const now = new Date().toISOString();
  return {
    id: `JOB${String(jobNumber).padStart(23, '0')}`,
    order_ulid: order.ulid,
    queue_no: order.queue_no,
    kind: printer.role === 'cashier' ? 'receipt' : 'kitchen',
    printer_id: printer.id,
    printer_name: printer.name,
    printer_role: printer.role,
    copy_no: 1,
    copies: 1,
    is_reprint: false,
    order_json: JSON.stringify(order),
    item_ids: printer.role === 'cashier' ? null : JSON.stringify([101, 102]),
    status: 'pending',
    attempts: 0,
    error: null,
    dismissed: false,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

async function run(...jobs: PrintJobInsert[]): Promise<string[]> {
  const ids = await printRepository.insertJobs(jobs);
  await queue.enqueue(ids);
  await queue.idle();
  return ids;
}

async function row(id: string) {
  return printRepository.getJob(id);
}

beforeEach(async () => {
  await freshTestDatabase();
  fake = createFakeTransport();
  config = makePrintConfig();
  sleep = jest.fn(async () => undefined);
  queue = createPrintQueue({
    repository: printRepository,
    getTransport: () => fake.transport,
    getConfig: () => config,
    render: renderJob,
    sleep,
    now: Date.now,
    onJobChanged: jest.fn(),
  });
});

describe('sending', () => {
  it('sends the rendered document to the printer and marks the job "sent"', async () => {
    const [id] = await run(job(KITCHEN));
    expect(await row(id)).toMatchObject({ status: 'sent', attempts: 1, error: null });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].target).toEqual({ host: '192.168.1.60', port: 9101 });
    expect(printedLines(fake.sent[0].bytes).slice(0, 2)).toEqual(['KITCHEN', '#17']);
  });

  it('retries connect errors: 3 attempts at 0 s, +2 s and +4 s', async () => {
    fake.fail(9101, 'timeout', 2);
    const [id] = await run(job(KITCHEN));
    expect(sleep.mock.calls).toEqual([[2000], [4000]]);
    expect(fake.attempts).toHaveLength(3);
    expect(await row(id)).toMatchObject({ status: 'sent', attempts: 3 });
  });

  it('fails after 3 connect attempts with "<printer> isn\'t responding."', async () => {
    fake.fail(9101, 'refused');
    const [id] = await run(job(KITCHEN));
    expect(fake.attempts).toHaveLength(3);
    expect(await row(id)).toMatchObject({ status: 'failed', attempts: 3, error: "Kitchen isn't responding." });
  });

  it('never retries a write error automatically', async () => {
    fake.fail(9101, 'write');
    const [id] = await run(job(KITCHEN));
    expect(sleep).not.toHaveBeenCalled();
    expect(fake.attempts).toHaveLength(1);
    expect(await row(id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: 'Kitchen may have printed part of this. Check before retrying.',
    });
  });

  it('fails a job whose printer was turned off or removed, without sending', async () => {
    config = makePrintConfig({ printers: [COUNTER, { ...KITCHEN, is_enabled: false }] });
    const [off] = await run(job(KITCHEN));
    config = makePrintConfig({ printers: [COUNTER] });
    const [gone] = await run(job(KITCHEN, { is_reprint: true }));
    expect(await row(off)).toMatchObject({ status: 'failed', error: 'Kitchen is turned off in Printers.' });
    expect(await row(gone)).toMatchObject({ status: 'failed', error: 'Kitchen is no longer in the printer list.' });
    expect(fake.attempts).toHaveLength(0);
  });

  it('reads host, port and width from the current config at send time (fix the IP, then Retry)', async () => {
    fake.fail(9101, 'unreachable');
    const [id] = await run(job(KITCHEN));
    expect((await row(id))?.status).toBe('failed');

    config = makePrintConfig({ printers: [COUNTER, { ...KITCHEN, host: '192.168.1.61', port: 9200, paper_width_mm: 58 }] });
    await printRepository.updateJob(id, { status: 'pending', attempts: 0, error: null }, new Date().toISOString());
    await queue.enqueue([id]);
    await queue.idle();

    expect(await row(id)).toMatchObject({ status: 'sent' });
    const last = fake.sent[fake.sent.length - 1];
    expect(last.target).toEqual({ host: '192.168.1.61', port: 9200 });
    expect(printedLines(last.bytes)).toContain('-'.repeat(32));
  });
});

describe('lanes', () => {
  it('when a job runs out of attempts, the other jobs waiting in that lane fail at once', async () => {
    fake.fail(9101, 'timeout');
    const [first, second] = await run(job(KITCHEN), job(KITCHEN, { is_reprint: true }));
    expect(fake.attempts).toHaveLength(3);
    expect(await row(first)).toMatchObject({ status: 'failed', attempts: 3 });
    expect(await row(second)).toMatchObject({ status: 'failed', attempts: 0, error: "Kitchen isn't responding." });
  });

  it('runs lanes in parallel: a stuck kitchen printer never delays the receipt', async () => {
    fake.hold(9101);
    const ids = await printRepository.insertJobs([job(KITCHEN), job(COUNTER)]);
    await queue.enqueue(ids);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await row(ids[1])).toMatchObject({ status: 'sent' });
    expect(await row(ids[0])).toMatchObject({ status: 'printing' });
    expect(queue.isBusy({ host: '192.168.1.60', port: 9101 })).toBe(true);
    fake.release(9101);
    await queue.idle();
    expect(await row(ids[0])).toMatchObject({ status: 'sent' });
  });

  it('runs one job at a time in a lane, in order', async () => {
    const order: number[] = [];
    const ids = await printRepository.insertJobs([job(KITCHEN), job(KITCHEN, { is_reprint: true }), job(KITCHEN, { is_reprint: true })]);
    const original = fake.transport.send;
    let running = 0;
    fake.transport.send = async (target, bytes, timeout) => {
      running += 1;
      expect(running).toBe(1);
      order.push(fake.attempts.length);
      await original(target, bytes, timeout);
      running -= 1;
    };
    await queue.enqueue(ids);
    await queue.idle();
    expect(order).toEqual([0, 1, 2]);
  });
});

describe('storage', () => {
  it('deduplicates first prints per (order_ulid, kind, printer_id, copy_no), never reprints', async () => {
    const first = await printRepository.insertJobs([job(COUNTER), job(COUNTER, { copy_no: 2, copies: 2 })]);
    expect(first).toHaveLength(2);
    // A replayed 201 (or the Q-004 lookup) tries the same first prints again.
    expect(await printRepository.insertJobs([job(COUNTER), job(COUNTER, { copy_no: 2, copies: 2 })])).toEqual([]);
    // Reprints are never deduplicated.
    expect(await printRepository.insertJobs([job(COUNTER, { is_reprint: true }), job(COUNTER, { is_reprint: true })])).toHaveLength(2);
    expect(await printRepository.jobsForOrder(makeOrder().ulid)).toHaveLength(4);
  });

  it('startup recovery: pending and printing jobs become failed and are never reprinted silently', async () => {
    const ids = await printRepository.insertJobs([job(KITCHEN), job(COUNTER, { status: 'printing', attempts: 1 }), job(COUNTER, { is_reprint: true, status: 'sent' })]);
    expect(await printRepository.failInterrupted(new Date().toISOString())).toBe(2);
    expect(await row(ids[0])).toMatchObject({ status: 'failed', error: INTERRUPTED_MESSAGE });
    expect(await row(ids[1])).toMatchObject({ status: 'failed', error: 'The app closed before this printed.' });
    expect(await row(ids[2])).toMatchObject({ status: 'sent' });
    // Nothing is sent by recovery, and enqueueing a failed job does nothing.
    await queue.enqueue(ids);
    await queue.idle();
    expect(fake.attempts).toHaveLength(0);
  });

  it('prunes sent jobs after 1 day and failed ones after 7 days', async () => {
    const now = Date.parse('2026-09-25T12:00:00Z');
    const at = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString();
    const ids = await printRepository.insertJobs([
      job(COUNTER, { status: 'sent', updated_at: at(25) }),
      job(COUNTER, { status: 'sent', updated_at: at(23), is_reprint: true }),
      job(KITCHEN, { status: 'failed', updated_at: at(24 * 7 + 1) }),
      job(KITCHEN, { status: 'failed', updated_at: at(24 * 6), is_reprint: true }),
    ]);
    expect(await printRepository.prune(now)).toBe(2);
    expect((await printRepository.getJobs(ids)).map((kept) => kept.id).sort()).toEqual([ids[1], ids[3]].sort());
  });
});
