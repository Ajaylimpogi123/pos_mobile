/**
 * What the screens call to print (docs/api-contract.md → Printing). Every
 * function here catches its own errors: **printing never throws into the
 * sale flow**, and a printer failure never blocks, reverses or loses a sale.
 *
 * - `startPrinting` (once, at app start): startup recovery (jobs left
 *   `pending` or `printing` become `failed`, never reprinted silently), pruning,
 *   the failed jobs for the Sell banner, and this tablet's receipt printer choice.
 * - `printSale`: the first print of a completed sale (deduplicated per
 *   `(order_ulid, kind, printer_id, copy_no)`).
 * - `printReceipt`: "Print receipt" when auto-print is off.
 * - `reprintOrder`: Order detail → Reprint (receipt or every station), never deduplicated.
 * - `printShiftRead`: the X-read and Z-read shift reports (Phase 6), on the receipt printer.
 * - `printVoid`, `printRefundSlip`, `reprintVoidSlip` (Voids & Refunds, Phase 7): the void slip and the
 *   VOID kitchen tickets, the refund slip; first prints deduplicated like a sale's.
 * - `testPrint`, `printSample`: straight to one printer, through its lane; not stored.
 * - `retryJob`, `retryAllFailed`, `dismissJob`, `probePrinters`, `chooseReceiptPrinter`.
 */
import { captureError } from '@/errors/capture';
import { prepareDatabase } from '@/db/database';
import { printRepository } from '@/db/printRepository';
import type { PrintJobInsert, PrintJobRow } from '@/db/schema';
import { API_BASE_URL } from '@/services/api';
import { getReceiptPrinterId, saveReceiptPrinterId } from '@/services/secureStorage';
import type { BranchSettings, Order, OrderItem, PrintableOrder, PrintConfig, Printer, Refund, Tab, TabItem } from '@/services/types';
import { selectFailedJobs, toJobView, usePrintingStore } from '@/stores/printing';
import { useSessionStore } from '@/stores/session';
import { ulid } from '@/utils/ulid';

import { buildReceiptSample } from '@pos/core/printing/documents/receipt';
import type { RefundSlipDocument } from '@pos/core/printing/documents/refundSlip';
import type { ShiftReadDocument } from '@pos/core/printing/documents/shiftRead';
import { buildTestPage, type TestPageTarget } from '@pos/core/printing/documents/testPage';
import { columnsFor } from '@pos/core/printing/escpos/layout';
import { describeItem } from './labels';
import { CONNECT_TIMEOUT_MS, createPrintQueue, failureMessage, type PrintQueue } from './queue';
import { renderJob } from './render';
import { chooseReceiptPrinter, planSale, routeKitchen, routeTicketLines } from '@pos/core/printing/routing';
import type { BillDocument, TabRoundDocument, TabVoidDocument } from './tabDocuments';
import { getPrintTransport, isPrintTransportError, PrintTransportError, type PrintTarget } from './transport';

/** Contract: the success screen's message when this tablet has no receipt printer. */
export const NO_RECEIPT_PRINTER_MESSAGE = 'No receipt printer is set up for this tablet.';
export const CONFIG_NOT_SYNCED_MESSAGE = "The printer settings haven't reached this tablet yet. Connect to the network and sync.";
export const NO_CONFIG_MESSAGE =
  "The printer settings haven't reached this tablet yet. Once they sync, reprint this sale from Orders.";
export const STORAGE_MESSAGE = "Printing couldn't start: this tablet's storage couldn't be opened. Reprint this sale from Orders.";
export const START_FAILED_MESSAGE = "Printing couldn't start for this sale. Reprint it from Orders.";
export const NO_STATION_MESSAGE = 'No kitchen or bar printer takes these items.';

/** Reachability probes: a 3 s timeout, at most once a minute per printer. */
export const PROBE_TIMEOUT_MS = 3_000;
export const PROBE_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

let started: Promise<boolean> | null = null;
let queue: PrintQueue | null = null;

function store() {
  return usePrintingStore.getState();
}

function getQueue(): PrintQueue {
  if (!queue) {
    queue = createPrintQueue({
      repository: printRepository,
      getTransport: getPrintTransport,
      getConfig: () => store().config,
      render: renderJob,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: Date.now,
      onJobChanged: (row) => {
        store().upsertJobs([toJobView(row)]);
        // Phase 8 §F: a print that failed after all its retries goes to the error log.
        if (row.status === 'failed') {
          captureError(new Error(`Print failed: ${row.error ?? 'unknown error'}`), {
            level: 'warning',
            extra: { source: 'print_queue', kind: row.kind, printer_role: row.printer_role, attempts: String(row.attempts) },
          });
        }
      },
    });
  }
  return queue;
}

/** Test helper: forget the started state and the queue (each test has a fresh database). */
export function resetPrintingForTests(): void {
  started = null;
  queue = null;
}

/** Resolves when every lane is empty (tests, and nothing else). */
export function whenPrintQueueIdle(): Promise<void> {
  return queue ? queue.idle() : Promise.resolve();
}

/**
 * Startup (once; again after a failure): recovery, pruning, the failed jobs
 * and the receipt printer choice. `false` when the database can't be used.
 * Never rejects.
 */
export function startPrinting(): Promise<boolean> {
  if (started) return started;
  started = (async () => {
    try {
      if (!(await prepareDatabase())) {
        started = null;
        return false;
      }
      const now = Date.now();
      await printRepository.failInterrupted(new Date(now).toISOString());
      await printRepository.prune(now);
      store().upsertJobs((await printRepository.failedJobs()).map(toJobView));
      store().setReceiptPrinterId(await getReceiptPrinterId());
      return true;
    } catch {
      started = null;
      return false;
    }
  })();
  return started;
}

/** Loads the cached config of the signed-in user's branch (startup, or another branch signing in). Never rejects. */
export async function loadCachedPrintConfig(branchId: number): Promise<void> {
  try {
    if (!(await startPrinting())) return;
    if (store().config?.branch.id === branchId) return;
    const cached = await printRepository.readConfig(API_BASE_URL, branchId);
    // A config from another branch must never route this branch's sales.
    if (store().config?.branch.id !== branchId) store().setConfig(cached);
  } catch {
    // No cache: the next sync brings it.
  }
}

function newJob(
  order: PrintableOrder,
  printer: Printer,
  options: { kind: PrintJobRow['kind']; copyNo: number; copies: number; reprint: boolean; itemIds: number[] | null },
): PrintJobInsert {
  const now = new Date().toISOString();
  return {
    id: ulid(),
    order_ulid: order.ulid,
    queue_no: order.queue_no,
    kind: options.kind,
    printer_id: printer.id,
    printer_name: printer.name,
    printer_role: printer.role,
    copy_no: options.copyNo,
    copies: options.copies,
    is_reprint: options.reprint,
    order_json: JSON.stringify(order),
    item_ids: options.itemIds ? JSON.stringify(options.itemIds) : null,
    status: 'pending',
    attempts: 0,
    error: null,
    dismissed: false,
    created_at: now,
    updated_at: now,
  };
}

function receiptJobs(order: PrintableOrder, printer: Printer, copies: number, reprint: boolean): PrintJobInsert[] {
  return Array.from({ length: copies }, (_unused, index) =>
    newJob(order, printer, { kind: 'receipt', copyNo: index + 1, copies, reprint, itemIds: null }),
  );
}

function ticketJobs(order: PrintableOrder, config: PrintConfig, reprint: boolean): { jobs: PrintJobInsert[]; unrouted: OrderItem[] } {
  // A reprint is a manual request: it prints even when automatic kitchen tickets are off (Q-007).
  const routing = routeKitchen(order, config, { manual: reprint });
  const jobs = routing.tickets.map((ticket) =>
    newJob(order, ticket.printer, {
      kind: 'kitchen',
      copyNo: 1,
      copies: 1,
      reprint,
      itemIds: ticket.items.map((item) => item.id),
    }),
  );
  return { jobs, unrouted: routing.unrouted };
}

function clampCopies(copies: number): number {
  return Math.max(1, Math.min(3, Math.trunc(copies)));
}

/** Dine-in (T2): an equally split order prints one receipt per share (each its own copy); else `copies`. */
function receiptCountOf(order: PrintableOrder, copies: number): number {
  const shares = order.split_count ?? 0;
  return shares >= 2 && copies > 0 ? shares : copies;
}

/** Why printing can't run right now (`null`: it can), after making sure it started. */
async function blocker(): Promise<string | null> {
  const transport = getPrintTransport();
  if (!transport.available) return transport.unavailableMessage;
  if (!(await startPrinting())) return STORAGE_MESSAGE;
  return null;
}

/** Stores the jobs (first prints are skipped when they already exist) and queues the new ones. */
async function queueJobs(jobs: PrintJobInsert[]): Promise<string[]> {
  const inserted = await printRepository.insertJobs(jobs);
  const rows = await printRepository.getJobs(inserted);
  store().upsertJobs(rows.map(toJobView));
  await getQueue().enqueue(inserted);
  return inserted;
}

async function firstPrintsOf(orderUlid: string): Promise<PrintJobRow[]> {
  const rows = (await printRepository.jobsForOrder(orderUlid)).filter((row) => !row.is_reprint);
  store().upsertJobs(rows.map(toJobView));
  return rows;
}

// ---------------------------------------------------------------------------
// Sale, receipt, reprint
// ---------------------------------------------------------------------------

/**
 * The first print of a completed sale: `receipt_copies` receipts (auto-print
 * on) to this tablet's receipt printer, and one ticket per station. Called
 * right after a `201`, after the Q-004 lookup, and after an offline sale is
 * saved (the local order, Offline Sales). Deduplicated by the ULID: a replay,
 * or the server's `Order` of a synced offline sale, prints nothing new. Never rejects.
 */
export async function printSale(order: PrintableOrder): Promise<void> {
  const ulidOfSale = order.ulid;
  try {
    store().setSale(ulidOfSale, { preparing: true, notice: null });
    const blocked = await blocker();
    if (blocked) {
      store().setSale(ulidOfSale, { preparing: false, notice: blocked });
      return;
    }
    const config = store().config;
    if (!config) {
      store().setSale(ulidOfSale, { preparing: false, notice: NO_CONFIG_MESSAGE });
      return;
    }

    const plan = planSale(order, config, store().receiptPrinterId);
    const jobs = plan.receiptPrinter ? receiptJobs(order, plan.receiptPrinter, receiptCountOf(order, plan.receiptCopies), false) : [];
    // Dine-in §D.6: a settled tab prints the receipt only; its rounds already went to the kitchen.
    const fromTab = Boolean(order.tab_ulid);
    const tickets = fromTab ? { jobs: [], unrouted: [] } : ticketJobs(order, config, false);
    const inserted = await printRepository.insertJobs([...jobs, ...tickets.jobs]);

    const rows = await firstPrintsOf(ulidOfSale);
    store().setSale(ulidOfSale, {
      preparing: false,
      jobIds: rows.map((row) => row.id),
      unrouted: fromTab ? [] : plan.unrouted.map(describeItem),
      noReceiptPrinter: plan.receiptPrinter === null,
      manualReceipt: plan.manualReceipt && plan.receiptPrinter !== null && !rows.some((row) => row.kind === 'receipt'),
    });
    await getQueue().enqueue(inserted);
  } catch {
    store().setSale(ulidOfSale, { preparing: false, notice: START_FAILED_MESSAGE });
  }
}

/** "Print receipt" (auto-print off): `receipt_copies` receipts, as the sale's first print. Never rejects. */
export async function printReceipt(order: PrintableOrder): Promise<void> {
  const ulidOfSale = order.ulid;
  try {
    const blocked = await blocker();
    if (blocked) {
      store().setSale(ulidOfSale, { notice: blocked });
      return;
    }
    const config = store().config;
    const printer = config ? chooseReceiptPrinter(config.printers, store().receiptPrinterId) : null;
    if (!config || !printer) {
      store().setSale(ulidOfSale, { noReceiptPrinter: printer === null, manualReceipt: false, notice: config ? null : NO_CONFIG_MESSAGE });
      return;
    }
    const inserted = await printRepository.insertJobs(
      receiptJobs(order, printer, receiptCountOf(order, clampCopies(config.settings.receipt_copies)), false),
    );
    const rows = await firstPrintsOf(ulidOfSale);
    store().setSale(ulidOfSale, { jobIds: rows.map((row) => row.id), manualReceipt: false });
    await getQueue().enqueue(inserted);
  } catch {
    store().setSale(ulidOfSale, { notice: START_FAILED_MESSAGE });
  }
}

export type ReprintKind = 'receipt' | 'kitchen';

export type ReprintResult = {
  /** The reprint jobs (their rows show the progress). */
  jobIds: string[];
  /** Why nothing (or not everything) was sent. */
  notice: string | null;
  /** Kitchen: lines no enabled printer takes. */
  unrouted: string[];
};

/**
 * Order detail → Reprint: one receipt (this tablet's printer) or every
 * station's ticket, all marked `*** REPRINT ***`, never deduplicated. Never rejects.
 */
export async function reprintOrder(order: PrintableOrder, kind: ReprintKind): Promise<ReprintResult> {
  try {
    const blocked = await blocker();
    if (blocked) return { jobIds: [], notice: blocked, unrouted: [] };
    const config = store().config;
    if (!config) return { jobIds: [], notice: CONFIG_NOT_SYNCED_MESSAGE, unrouted: [] };

    if (kind === 'receipt') {
      const printer = chooseReceiptPrinter(config.printers, store().receiptPrinterId);
      if (!printer) return { jobIds: [], notice: NO_RECEIPT_PRINTER_MESSAGE, unrouted: [] };
      return { jobIds: await queueJobs(receiptJobs(order, printer, receiptCountOf(order, 1), true)), notice: null, unrouted: [] };
    }

    const tickets = ticketJobs(order, config, true);
    const unrouted = tickets.unrouted.map(describeItem);
    if (tickets.jobs.length === 0) return { jobIds: [], notice: NO_STATION_MESSAGE, unrouted };
    return { jobIds: await queueJobs(tickets.jobs), notice: null, unrouted };
  } catch {
    return { jobIds: [], notice: "The reprint couldn't start. Try again.", unrouted: [] };
  }
}

// ---------------------------------------------------------------------------
// Shift reports (Phase 6)
// ---------------------------------------------------------------------------

export type ShiftReadPrintResult = {
  jobIds: string[];
  /** Why nothing was sent (no receipt printer, Expo Go, no config yet, …). */
  notice: string | null;
};

/**
 * Prints an X-read or a Z-read on this tablet's receipt printer, through the
 * queue (so a failure shows on the Sell banner with Retry). A first Z-read is
 * deduplicated per shift; an X-read never is (each one is a new snapshot).
 * `reprint`: a Z-read reprinted from the shift history, marked `*** REPRINT ***`.
 * Never rejects.
 */
export async function printShiftRead(doc: ShiftReadDocument, options: { reprint?: boolean } = {}): Promise<ShiftReadPrintResult> {
  try {
    const blocked = await blocker();
    if (blocked) return { jobIds: [], notice: blocked };
    const config = store().config;
    if (!config) return { jobIds: [], notice: CONFIG_NOT_SYNCED_MESSAGE };
    const printer = chooseReceiptPrinter(config.printers, store().receiptPrinterId);
    if (!printer) return { jobIds: [], notice: NO_RECEIPT_PRINTER_MESSAGE };

    const now = new Date().toISOString();
    const job: PrintJobInsert = {
      id: ulid(),
      order_ulid: doc.shift.ulid,
      queue_no: 0,
      kind: doc.kind,
      printer_id: printer.id,
      printer_name: printer.name,
      printer_role: printer.role,
      copy_no: 1,
      copies: 1,
      is_reprint: options.reprint ?? false,
      order_json: JSON.stringify(doc),
      item_ids: null,
      status: 'pending',
      attempts: 0,
      error: null,
      dismissed: false,
      created_at: now,
      updated_at: now,
    };
    const inserted = await queueJobs([job]);
    if (inserted.length > 0) return { jobIds: inserted, notice: null };
    // A first Z-read already exists for this shift: show that one.
    const existing = (await printRepository.jobsForOrder(doc.shift.ulid)).filter((row) => row.kind === doc.kind && !row.is_reprint);
    store().upsertJobs(existing.map(toJobView));
    return { jobIds: existing.map((row) => row.id), notice: null };
  } catch {
    return { jobIds: [], notice: "The shift report couldn't be sent to the printer. Try again." };
  }
}

// ---------------------------------------------------------------------------
// Voids & refunds (Phase 7)
// ---------------------------------------------------------------------------

/** What printing did for a void or a refund (shown in the dialog / on the refund screen). */
export type ReversalPrintResult = {
  /** The jobs (their rows show the progress). */
  jobIds: string[];
  /** Why nothing (or not everything) was sent. */
  notice: string | null;
  /** VOID tickets: lines no enabled station takes. */
  unrouted: string[];
};

export const REVERSAL_PRINT_FAILED_MESSAGE = "This couldn't be sent to the printer. Reprint it from the order.";

const VOID_KINDS: readonly PrintJobRow['kind'][] = ['void_slip', 'kitchen_void'];

/**
 * After a void's `200`: the **void slip** on this tablet's receipt printer
 * (1 copy) and a **VOID kitchen ticket** to each station the sale's lines
 * route to (as for kitchen tickets), when `print_kitchen_tickets` is on.
 * First prints are deduplicated per `(order_ulid, kind, printer_id, copy_no)`,
 * so a replayed `200` shows the jobs already made. Never rejects.
 */
export async function printVoid(order: Order): Promise<ReversalPrintResult> {
  try {
    const blocked = await blocker();
    if (blocked) return { jobIds: [], notice: blocked, unrouted: [] };
    const config = store().config;
    if (!config) return { jobIds: [], notice: CONFIG_NOT_SYNCED_MESSAGE, unrouted: [] };

    const printer = chooseReceiptPrinter(config.printers, store().receiptPrinterId);
    const jobs: PrintJobInsert[] = printer
      ? [newJob(order, printer, { kind: 'void_slip', copyNo: 1, copies: 1, reprint: false, itemIds: null })]
      : [];
    const routing = routeKitchen(order, config);
    for (const ticket of routing.tickets) {
      jobs.push(
        newJob(order, ticket.printer, {
          kind: 'kitchen_void',
          copyNo: 1,
          copies: 1,
          reprint: false,
          itemIds: ticket.items.map((item) => item.id),
        }),
      );
    }
    const inserted = await printRepository.insertJobs(jobs);
    const rows = (await printRepository.jobsForOrder(order.ulid)).filter((row) => !row.is_reprint && VOID_KINDS.includes(row.kind));
    store().upsertJobs(rows.map(toJobView));
    await getQueue().enqueue(inserted);
    return { jobIds: rows.map((row) => row.id), notice: printer ? null : NO_RECEIPT_PRINTER_MESSAGE, unrouted: routing.unrouted.map(describeItem) };
  } catch {
    return { jobIds: [], notice: REVERSAL_PRINT_FAILED_MESSAGE, unrouted: [] };
  }
}

/** Order detail → Reprint → Void slip: one void slip marked `*** REPRINT ***`, never deduplicated. Never rejects. */
export async function reprintVoidSlip(order: Order): Promise<ReprintResult> {
  try {
    const blocked = await blocker();
    if (blocked) return { jobIds: [], notice: blocked, unrouted: [] };
    const config = store().config;
    if (!config) return { jobIds: [], notice: CONFIG_NOT_SYNCED_MESSAGE, unrouted: [] };
    const printer = chooseReceiptPrinter(config.printers, store().receiptPrinterId);
    if (!printer) return { jobIds: [], notice: NO_RECEIPT_PRINTER_MESSAGE, unrouted: [] };
    const job = newJob(order, printer, { kind: 'void_slip', copyNo: 1, copies: 1, reprint: true, itemIds: null });
    return { jobIds: await queueJobs([job]), notice: null, unrouted: [] };
  } catch {
    return { jobIds: [], notice: "The reprint couldn't start. Try again.", unrouted: [] };
  }
}

/**
 * The **refund slip** of one refund on this tablet's receipt printer (1
 * copy). The job keeps the refund's ULID, so each refund's first print is
 * deduplicated on its own; `reprint` (Order detail → Reprint → Refund slip)
 * is marked `*** REPRINT ***` and never deduplicated. Never rejects.
 */
export async function printRefundSlip(order: Order, refund: Refund, options: { reprint?: boolean } = {}): Promise<ReversalPrintResult> {
  const reprint = options.reprint ?? false;
  try {
    const blocked = await blocker();
    if (blocked) return { jobIds: [], notice: blocked, unrouted: [] };
    const config = store().config;
    if (!config) return { jobIds: [], notice: CONFIG_NOT_SYNCED_MESSAGE, unrouted: [] };
    const printer = chooseReceiptPrinter(config.printers, store().receiptPrinterId);
    if (!printer) return { jobIds: [], notice: NO_RECEIPT_PRINTER_MESSAGE, unrouted: [] };

    const doc: RefundSlipDocument = {
      order: { ulid: order.ulid, invoice_no: order.invoice_no, order_no: order.order_no, queue_no: order.queue_no },
      refund,
    };
    const now = new Date().toISOString();
    const job: PrintJobInsert = {
      id: ulid(),
      order_ulid: refund.ulid,
      queue_no: order.queue_no,
      kind: 'refund_slip',
      printer_id: printer.id,
      printer_name: printer.name,
      printer_role: printer.role,
      copy_no: 1,
      copies: 1,
      is_reprint: reprint,
      order_json: JSON.stringify(doc),
      item_ids: null,
      status: 'pending',
      attempts: 0,
      error: null,
      dismissed: false,
      created_at: now,
      updated_at: now,
    };
    const inserted = await queueJobs([job]);
    if (reprint || inserted.length > 0) return { jobIds: inserted, notice: null, unrouted: [] };
    // A replayed `201`: this refund's first slip already exists; show that one.
    const existing = (await printRepository.jobsForOrder(refund.ulid)).filter((row) => row.kind === 'refund_slip' && !row.is_reprint);
    store().upsertJobs(existing.map(toJobView));
    return { jobIds: existing.map((row) => row.id), notice: null, unrouted: [] };
  } catch {
    return { jobIds: [], notice: REVERSAL_PRINT_FAILED_MESSAGE, unrouted: [] };
  }
}

// ---------------------------------------------------------------------------
// Test print and sample
// ---------------------------------------------------------------------------

export type DirectPrintResult = { ok: boolean; message: string };

function branchTimeZone(): string {
  return store().config?.branch.timezone ?? useSessionStore.getState().user?.branch.timezone ?? '';
}

function describeTarget(name: string, target: PrintTarget): string {
  return name.trim() === '' ? `${target.host}:${target.port}` : name.trim();
}

/** Sends bytes straight to one printer, in its lane (one attempt). Never rejects. */
async function sendDirect(name: string, target: PrintTarget, bytes: Uint8Array, success: string): Promise<DirectPrintResult> {
  const transport = getPrintTransport();
  if (!transport.available) return { ok: false, message: transport.unavailableMessage ?? '' };
  try {
    await getQueue().runInLane(target, () => transport.send(target, bytes, CONNECT_TIMEOUT_MS));
    return { ok: true, message: success };
  } catch (raw) {
    const error = isPrintTransportError(raw) ? raw : new PrintTransportError('unknown', String(raw));
    return { ok: false, message: failureMessage(describeTarget(name, target), error) };
  }
}

/**
 * Test print: the test page to a saved printer or to the one being edited
 * (before it is saved). Not stored in the queue. Never rejects.
 */
export async function testPrint(target: TestPageTarget): Promise<DirectPrintResult> {
  try {
    const bytes = buildTestPage(target, { timeZone: branchTimeZone(), now: Date.now() });
    const address = { host: target.host.trim(), port: target.port };
    return await sendDirect(target.name, address, bytes, `Test page sent to ${describeTarget(target.name, address)}. Check that it printed.`);
  } catch {
    return { ok: false, message: "The test page couldn't be sent." };
  }
}

/** Settings → Print sample: the header and footer lines being edited, on this tablet's receipt printer. Never rejects. */
export async function printSample(
  settings: Pick<BranchSettings, 'receipt_header_lines' | 'receipt_footer_lines'>,
): Promise<DirectPrintResult> {
  try {
    const config = store().config;
    const printer = config ? chooseReceiptPrinter(config.printers, store().receiptPrinterId) : null;
    if (!printer) return { ok: false, message: NO_RECEIPT_PRINTER_MESSAGE };
    const bytes = buildReceiptSample(settings, {
      columns: columnsFor(printer.paper_width_mm),
      timeZone: branchTimeZone(),
      now: Date.now(),
    });
    return await sendDirect(printer.name, { host: printer.host, port: printer.port }, bytes, `Sample sent to ${printer.name}.`);
  } catch {
    return { ok: false, message: "The sample couldn't be sent." };
  }
}

// ---------------------------------------------------------------------------
// Failed jobs
// ---------------------------------------------------------------------------

/** Retry: the failed job goes back to its lane (host and port from the current config). Never rejects. */
export async function retryJob(id: string): Promise<void> {
  try {
    if (!(await startPrinting())) return;
    const job = await printRepository.getJob(id);
    if (!job || job.status !== 'failed') return;
    const updatedAt = new Date().toISOString();
    const changes = { status: 'pending' as const, attempts: 0, error: null, dismissed: false };
    await printRepository.updateJob(id, changes, updatedAt);
    store().upsertJobs([toJobView({ ...job, ...changes, updated_at: updatedAt })]);
    await getQueue().enqueue([id]);
  } catch {
    // The job stays failed, with its Retry.
  }
}

/** "Retry all" on the Sell banner. Never rejects. */
export async function retryAllFailed(): Promise<void> {
  for (const job of selectFailedJobs(store().jobs)) await retryJob(job.id);
}

/** Hides a failure from the Sell banner (the job stays failed; Reprint is in Orders). Never rejects. */
export async function dismissJob(id: string): Promise<void> {
  try {
    const job = store().jobs[id];
    if (!job) return;
    const updatedAt = new Date().toISOString();
    store().upsertJobs([{ ...job, dismissed: true, updatedAt }]);
    await printRepository.updateJob(id, { dismissed: true }, updatedAt);
  } catch {
    // Dismissed on screen; the stored row catches up next time.
  }
}

// ---------------------------------------------------------------------------
// Receipt printer choice and reachability
// ---------------------------------------------------------------------------

/** "Receipts from this tablet": saved on the device. Never rejects. */
export async function chooseReceiptPrinterForTablet(printerId: number): Promise<void> {
  store().setReceiptPrinterId(printerId);
  await saveReceiptPrinterId(printerId);
}

/**
 * Reachability probes (a 3 s connect) of `printers`, skipping disabled ones,
 * busy lanes, and printers probed less than a minute ago (unless `force`).
 * Results go to the store. Never rejects.
 */
export async function probePrinters(printers: readonly Printer[], options: { force?: boolean } = {}): Promise<void> {
  try {
    const transport = getPrintTransport();
    if (!transport.available) return;
    const now = Date.now();
    const probes: Promise<void>[] = [];
    for (const printer of printers) {
      if (!printer.is_enabled) continue;
      const target = { host: printer.host, port: printer.port };
      const last = store().reachability[printer.id];
      if (last?.state === 'checking') continue;
      if (!options.force && last && now - last.checkedAt < PROBE_INTERVAL_MS) continue;
      if (queue?.isBusy(target)) continue;
      store().setReachability(printer.id, { state: 'checking', checkedAt: last?.checkedAt ?? 0 });
      probes.push(
        transport.probe(target, PROBE_TIMEOUT_MS).then(
          () => store().setReachability(printer.id, { state: 'ok', checkedAt: Date.now() }),
          () => store().setReachability(printer.id, { state: 'down', checkedAt: Date.now() }),
        ),
      );
    }
    await Promise.all(probes);
  } catch {
    // Unknown reachability simply shows as unknown.
  }
}

/** The printers the Sell pill watches: this tablet's receipt printer and the enabled kitchen and bar printers. */
export function sellPrinters(config: PrintConfig | null, receiptPrinterId: number | null): Printer[] {
  if (!config) return [];
  const receipt = chooseReceiptPrinter(config.printers, receiptPrinterId);
  const stations = config.printers.filter((printer) => printer.is_enabled && printer.role !== 'cashier');
  return receipt ? [receipt, ...stations] : stations;
}

// ---------------------------------------------------------------------------
// Dine-in Tables & Tabs (§F)
// ---------------------------------------------------------------------------

export type TabPrintResult = {
  /** The jobs (their rows show the progress). */
  jobIds: string[];
  /** Why nothing (or not everything) was sent. */
  notice: string | null;
  /** Tickets: lines no enabled station takes, e.g. "2 x Sisig". */
  unrouted: string[];
};

export const TAB_PRINT_FAILED_MESSAGE = "This couldn't be sent to the printer.";

function tabJob(
  key: string,
  printer: Printer,
  options: { kind: PrintJobRow['kind']; queueNo: number; json: string; itemIds: number[] | null; reprint?: boolean },
): PrintJobInsert {
  const now = new Date().toISOString();
  return {
    id: ulid(),
    order_ulid: key,
    queue_no: options.queueNo,
    kind: options.kind,
    printer_id: printer.id,
    printer_name: printer.name,
    printer_role: printer.role,
    copy_no: 1,
    copies: 1,
    is_reprint: options.reprint ?? false,
    order_json: options.json,
    item_ids: options.itemIds ? JSON.stringify(options.itemIds) : null,
    status: 'pending',
    attempts: 0,
    error: null,
    dismissed: false,
    created_at: now,
    updated_at: now,
  };
}

/** Stores and queues station tickets for tab lines, routed like a sale's (and only while `print_kitchen_tickets` is on). */
async function printTabTickets(
  key: string,
  kind: 'tab_round' | 'tab_void',
  queueNo: number,
  items: readonly TabItem[],
  json: string,
): Promise<TabPrintResult> {
  const blocked = await blocker();
  if (blocked) return { jobIds: [], notice: blocked, unrouted: [] };
  const config = store().config;
  if (!config) return { jobIds: [], notice: CONFIG_NOT_SYNCED_MESSAGE, unrouted: [] };
  const routing = routeTicketLines(items, config);
  const jobs = routing.tickets.map((ticket) =>
    tabJob(key, ticket.printer, { kind, queueNo, json, itemIds: ticket.items.map((item) => item.id) }),
  );
  const inserted = await printRepository.insertJobs(jobs);
  // A replayed answer: the first prints already exist for this key; show those.
  const rows = (await printRepository.jobsForOrder(key)).filter((row) => row.kind === kind && !row.is_reprint);
  store().upsertJobs(rows.map(toJobView));
  await getQueue().enqueue(inserted);
  return { jobIds: rows.map((row) => row.id), notice: null, unrouted: routing.unrouted.map(describeItem) };
}

/**
 * After **Send to kitchen** (`200 {data, round_no}`): the round's kitchen
 * ticket, one per station (`TABLE 5`, `ROUND 2 · 3 guests`, the server, the
 * round's items only), when `print_kitchen_tickets` is on. Deduplicated by the
 * round's ULID. Never rejects.
 */
export async function printTabRound(tab: Tab, roundNo: number, roundUlid: string, serverName: string): Promise<TabPrintResult> {
  try {
    const items = tab.items.filter((item) => item.round_no === roundNo);
    const doc: TabRoundDocument = {
      tab: { ulid: tab.ulid, table: tab.table, guests: tab.guests, notes: tab.notes },
      items,
      round_no: roundNo,
      server_name: serverName,
      sent_at: items[0]?.added_at ?? new Date().toISOString(),
    };
    return await printTabTickets(roundUlid, 'tab_round', roundNo, items, JSON.stringify(doc));
  } catch {
    return { jobIds: [], notice: TAB_PRINT_FAILED_MESSAGE, unrouted: [] };
  }
}

/** After a sent item is cancelled: the VOID kitchen ticket for the cancelled quantity, per station. Never rejects. */
export async function printTabVoid(tab: Tab, item: TabItem, qty: number, cancelKey: string): Promise<TabPrintResult> {
  try {
    const items = [{ ...item, qty }];
    const doc: TabVoidDocument = {
      tab: { ulid: tab.ulid, table: tab.table },
      items,
      cancelled_at: new Date().toISOString(),
    };
    return await printTabTickets(cancelKey, 'tab_void', 0, items, JSON.stringify(doc));
  } catch {
    return { jobIds: [], notice: TAB_PRINT_FAILED_MESSAGE, unrouted: [] };
  }
}

/** **Print bill**: the bill (`BILL — NOT A RECEIPT`) on this tablet's receipt printer, as often as asked. Never rejects. */
export async function printBill(tab: Tab, splitCount: number | null = null): Promise<TabPrintResult> {
  try {
    const blocked = await blocker();
    if (blocked) return { jobIds: [], notice: blocked, unrouted: [] };
    const config = store().config;
    if (!config) return { jobIds: [], notice: CONFIG_NOT_SYNCED_MESSAGE, unrouted: [] };
    const printer = chooseReceiptPrinter(config.printers, store().receiptPrinterId);
    if (!printer) return { jobIds: [], notice: NO_RECEIPT_PRINTER_MESSAGE, unrouted: [] };
    const doc: BillDocument = {
      tab: { ulid: tab.ulid, table: tab.table, guests: tab.guests, items: tab.items },
      printed_at: Date.now(),
      service_charge_bps: config.settings.service_charge_bps ?? 0,
      split_count: splitCount,
    };
    const job = tabJob(ulid(), printer, { kind: 'bill', queueNo: 0, json: JSON.stringify(doc), itemIds: null });
    return { jobIds: await queueJobs([job]), notice: null, unrouted: [] };
  } catch {
    return { jobIds: [], notice: TAB_PRINT_FAILED_MESSAGE, unrouted: [] };
  }
}
