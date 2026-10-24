/**
 * What to print, as `POST /print-jobs` bodies (Web POS §D/§F). The routing,
 * the documents and their wording are the tablet's (`@pos/core/printing/routing`, `@pos/core/printing/documents`,
 * `./labels`); only the transport differs: each job is sent to the server's
 * queue with a new ULID and the bytes in base64, and the print agent on the
 * restaurant LAN sends them to the printer.
 *
 * - A sale: `receipt_copies` receipts to this terminal's receipt printer
 *   (when `auto_print_receipt` is on), and one ticket per station.
 * - Auto-print off: **Print receipt** prints the configured copies once, as first prints.
 * - Reprint (order detail): one receipt, or every station's ticket (even with
 *   `print_kitchen_tickets` off, Q-007), marked `*** REPRINT ***`.
 * - Test print (Printers) and Print sample (Receipt settings): `kind: "test"`.
 * - Shifts: the X-read and Z-read (`x_read`, `z_read`). Voids and refunds:
 *   the void slip, the VOID kitchen tickets and the refund slip.
 * - Dine-in Tables & Tabs §F: a round's kitchen tickets (`kitchen`), a
 *   cancelled item's VOID tickets (`kitchen_void`), the bill (`bill`) and a
 *   settlement's receipts (`receipt`, no kitchen tickets: the rounds were
 *   already sent; one receipt per share for an equal split).
 * Pure: config and order in, request bodies out. Never throws into the sale flow.
 */
import type { Order, OrderItem, PrintableOrder, PrintConfig, Printer, PrintJobCreateRequest, PrintJobKind, Refund, Tab, TabItem } from '@/services/types';
import { ulid } from '@/utils/ulid';

import { receiptShares, type ReceiptSettings } from '@pos/core/printing/documents/receipt';
import type { RefundSlipDocument } from '@pos/core/printing/documents/refundSlip';
import type { ShiftReadDocument } from '@pos/core/printing/documents/shiftRead';
import { describeItem, jobLabel } from './labels';
import { bytesToBase64, renderJob, type RenderSpec } from './render';
import { chooseReceiptPrinter, planSale, routeKitchen, routeTicketLines } from '@pos/core/printing/routing';

/** Contract wording (Printing → Routing), "tablet" → "terminal". */
export const NO_RECEIPT_PRINTER_MESSAGE = 'No receipt printer is set up for this terminal.';
export const NO_STATION_MESSAGE = 'No kitchen or bar printer takes these items.';
export const NO_CONFIG_MESSAGE = "The printer settings couldn't be loaded. Reprint this sale from Order History.";

/** One job, ready to send, with the words the status list shows. */
export type PlannedJob = {
  request: PrintJobCreateRequest;
  label: string;
  printerName: string;
};

export type PrintPlan = {
  jobs: PlannedJob[];
  /** Lines no enabled printer takes ("Not sent to any printer"). */
  unrouted: Pick<OrderItem, 'qty' | 'product_name'>[];
  /** Auto-print is off and there is a receipt printer: offer **Print receipt**. */
  manualReceipt: boolean;
  /** Why something won't print (no receipt printer…). */
  notices: string[];
};

function plannedJob(
  printer: Printer,
  config: PrintConfig,
  spec: RenderSpec,
  meta: { kind: PrintJobKind; orderUlid: string | null; copyNo: number; isReprint: boolean; label: string },
): PlannedJob {
  const bytes = renderJob(spec, config, printer);
  return {
    request: {
      ulid: ulid(),
      printer_id: printer.id,
      kind: meta.kind,
      order_ulid: meta.orderUlid,
      copy_no: meta.copyNo,
      is_reprint: meta.isReprint,
      payload_base64: bytesToBase64(bytes),
    },
    label: meta.label,
    printerName: printer.name,
  };
}

function receiptJobs(order: PrintableOrder, config: PrintConfig, printer: Printer, copies: number, reprint: boolean): PlannedJob[] {
  return Array.from({ length: copies }, (_, index) => {
    const copyNo = index + 1;
    return plannedJob(
      printer,
      config,
      { kind: 'receipt', order, copyNo, copies, reprint },
      {
        kind: 'receipt',
        orderUlid: order.ulid,
        copyNo,
        isReprint: reprint,
        label: jobLabel({ kind: 'receipt', printerRole: printer.role, queueNo: order.queue_no, copyNo, copies, isReprint: reprint }),
      },
    );
  });
}

function ticketJobs(order: PrintableOrder, config: PrintConfig, tickets: ReturnType<typeof routeKitchen>['tickets'], reprint: boolean): PlannedJob[] {
  return tickets.map((ticket) =>
    plannedJob(
      ticket.printer,
      config,
      { kind: 'kitchen', order, items: ticket.items, reprint },
      {
        kind: 'kitchen',
        orderUlid: order.ulid,
        copyNo: 1,
        isReprint: reprint,
        label: jobLabel({ kind: 'kitchen', printerRole: ticket.printer.role, queueNo: order.queue_no, copyNo: 1, copies: 1, isReprint: reprint }),
      },
    ),
  );
}

function copiesOf(config: PrintConfig): number {
  return Math.max(1, Math.min(3, Math.trunc(config.settings.receipt_copies)));
}

/** Everything a completed sale prints (first prints; the server deduplicates a repeat). */
export function planSalePrint(order: PrintableOrder, config: PrintConfig, receiptPrinterId: number | null): PrintPlan {
  const plan = planSale(order, config, receiptPrinterId);
  const notices: string[] = [];
  if (!plan.receiptPrinter) notices.push(NO_RECEIPT_PRINTER_MESSAGE);
  const jobs = [
    ...(plan.receiptPrinter && plan.receiptCopies > 0 ? receiptJobs(order, config, plan.receiptPrinter, plan.receiptCopies, false) : []),
    ...ticketJobs(order, config, plan.tickets, false),
  ];
  return { jobs, unrouted: plan.unrouted, manualReceipt: plan.manualReceipt && plan.receiptPrinter !== null, notices };
}

/** **Print receipt** with auto-print off: the configured copies, once, as first prints. */
export function planManualReceipt(order: PrintableOrder, config: PrintConfig, receiptPrinterId: number | null): PrintPlan {
  const printer = chooseReceiptPrinter(config.printers, receiptPrinterId);
  if (!printer) return { jobs: [], unrouted: [], manualReceipt: false, notices: [NO_RECEIPT_PRINTER_MESSAGE] };
  return { jobs: receiptJobs(order, config, printer, copiesOf(config), false), unrouted: [], manualReceipt: false, notices: [] };
}

export type ReprintKind = 'receipt' | 'kitchen';

/** Order detail → Reprint: one receipt, or every station's ticket; never deduplicated. */
export function planReprint(order: PrintableOrder, config: PrintConfig, receiptPrinterId: number | null, kind: ReprintKind): PrintPlan {
  if (kind === 'receipt') {
    const printer = chooseReceiptPrinter(config.printers, receiptPrinterId);
    if (!printer) return { jobs: [], unrouted: [], manualReceipt: false, notices: [NO_RECEIPT_PRINTER_MESSAGE] };
    return { jobs: receiptJobs(order, config, printer, 1, true), unrouted: [], manualReceipt: false, notices: [] };
  }
  // Q-007: a manual reprint of the tickets prints even with `print_kitchen_tickets` off.
  const routing = routeKitchen(order, config, { manual: true });
  const notices = routing.tickets.length === 0 ? [NO_STATION_MESSAGE] : [];
  return { jobs: ticketJobs(order, config, routing.tickets, true), unrouted: routing.unrouted, manualReceipt: false, notices };
}

// ---------------------------------------------------------------------------
// Shifts (Phase 6): the X-read and the Z-read
// ---------------------------------------------------------------------------

/**
 * The X-read (any time while the shift is open) or the Z-read (when it
 * closes, and reprinted from the Shifts detail) on this terminal's receipt
 * printer. `order_ulid` is left out (the contract makes it optional for these
 * kinds, and they are never deduplicated).
 */
export function planShiftRead(doc: ShiftReadDocument, config: PrintConfig, receiptPrinterId: number | null, reprint: boolean): PrintPlan {
  const printer = chooseReceiptPrinter(config.printers, receiptPrinterId);
  if (!printer) return { jobs: [], unrouted: [], manualReceipt: false, notices: [NO_RECEIPT_PRINTER_MESSAGE] };
  const job = plannedJob(printer, config, { kind: 'shift_read', doc, reprint }, {
    kind: doc.kind,
    orderUlid: null,
    copyNo: 1,
    isReprint: reprint,
    label: jobLabel({ kind: doc.kind, printerRole: printer.role, queueNo: 0, copyNo: 1, copies: 1, isReprint: reprint }),
  });
  return { jobs: [job], unrouted: [], manualReceipt: false, notices: [] };
}

// ---------------------------------------------------------------------------
// Voids and refunds (Phase 7)
// ---------------------------------------------------------------------------

/**
 * After a void's `200`: the **void slip** on this terminal's receipt printer
 * (1 copy) and a **VOID kitchen ticket** to each station the sale's lines
 * route to, when `print_kitchen_tickets` is on. First prints: the server
 * deduplicates a repeat per `(order_ulid, kind, printer_id, copy_no)`.
 */
export function planVoidPrint(order: Order, config: PrintConfig, receiptPrinterId: number | null): PrintPlan {
  const printer = chooseReceiptPrinter(config.printers, receiptPrinterId);
  const notices = printer ? [] : [NO_RECEIPT_PRINTER_MESSAGE];
  const jobs: PlannedJob[] = [];
  if (printer) {
    jobs.push(
      plannedJob(printer, config, { kind: 'void_slip', order, reprint: false }, {
        kind: 'void_slip',
        orderUlid: order.ulid,
        copyNo: 1,
        isReprint: false,
        label: jobLabel({ kind: 'void_slip', printerRole: printer.role, queueNo: order.queue_no, copyNo: 1, copies: 1, isReprint: false }),
      }),
    );
  }
  const routing = routeKitchen(order, config);
  for (const ticket of routing.tickets) {
    jobs.push(
      plannedJob(ticket.printer, config, { kind: 'kitchen_void', order, items: ticket.items, reprint: false }, {
        kind: 'kitchen_void',
        orderUlid: order.ulid,
        copyNo: 1,
        isReprint: false,
        label: jobLabel({ kind: 'kitchen_void', printerRole: ticket.printer.role, queueNo: order.queue_no, copyNo: 1, copies: 1, isReprint: false }),
      }),
    );
  }
  return { jobs, unrouted: routing.unrouted, manualReceipt: false, notices };
}

/** Order detail → Reprint → Void slip: one slip marked `*** REPRINT ***`, never deduplicated. */
export function planVoidSlipReprint(order: Order, config: PrintConfig, receiptPrinterId: number | null): PrintPlan {
  const printer = chooseReceiptPrinter(config.printers, receiptPrinterId);
  if (!printer) return { jobs: [], unrouted: [], manualReceipt: false, notices: [NO_RECEIPT_PRINTER_MESSAGE] };
  const job = plannedJob(printer, config, { kind: 'void_slip', order, reprint: true }, {
    kind: 'void_slip',
    orderUlid: order.ulid,
    copyNo: 1,
    isReprint: true,
    label: jobLabel({ kind: 'void_slip', printerRole: printer.role, queueNo: order.queue_no, copyNo: 1, copies: 1, isReprint: true }),
  });
  return { jobs: [job], unrouted: [], manualReceipt: false, notices: [] };
}

/**
 * The **refund slip** of one refund (1 copy) on this terminal's receipt
 * printer. The job's `order_ulid` is the **refund's** ULID (Web POS §D), so
 * each refund's first print is deduplicated on its own; a reprint is marked
 * `*** REPRINT ***` and never deduplicated.
 */
export function planRefundSlip(order: Order, refund: Refund, config: PrintConfig, receiptPrinterId: number | null, reprint: boolean): PrintPlan {
  const printer = chooseReceiptPrinter(config.printers, receiptPrinterId);
  if (!printer) return { jobs: [], unrouted: [], manualReceipt: false, notices: [NO_RECEIPT_PRINTER_MESSAGE] };
  const doc: RefundSlipDocument = {
    order: { ulid: order.ulid, invoice_no: order.invoice_no, order_no: order.order_no, queue_no: order.queue_no },
    refund,
  };
  const job = plannedJob(printer, config, { kind: 'refund_slip', doc, reprint }, {
    kind: 'refund_slip',
    orderUlid: refund.ulid,
    copyNo: 1,
    isReprint: reprint,
    label: jobLabel({ kind: 'refund_slip', printerRole: printer.role, queueNo: order.queue_no, copyNo: 1, copies: 1, isReprint: reprint }),
  });
  return { jobs: [job], unrouted: [], manualReceipt: false, notices: [] };
}

/** Printers → **Test print**: the tablet's test page through the queue (`kind: "test"`). */
export function planTestPrint(printer: Printer, config: PrintConfig, now: number): PlannedJob {
  return plannedJob(printer, config, { kind: 'test', now }, {
    kind: 'test',
    orderUlid: null,
    copyNo: 1,
    isReprint: false,
    label: `Test print · ${printer.name}`,
  });
}

/**
 * Receipt settings → **Print sample** on this terminal's receipt printer, or why it can't.
 * Sent as `kind: "test"` (Q-037: it covers both the test page and the sample); only saved printers can be test-printed.
 */
export function planReceiptSample(
  config: PrintConfig,
  receiptPrinterId: number | null,
  settings: ReceiptSettings,
  now: number,
): { job: PlannedJob | null; notice: string | null } {
  const printer = chooseReceiptPrinter(config.printers, receiptPrinterId);
  if (!printer) return { job: null, notice: NO_RECEIPT_PRINTER_MESSAGE };
  return {
    job: plannedJob(printer, config, { kind: 'receipt_sample', now, settings }, {
      kind: 'test',
      orderUlid: null,
      copyNo: 1,
      isReprint: false,
      label: `Receipt sample · ${printer.name}`,
    }),
    notice: null,
  };
}

// ---------------------------------------------------------------------------
// Dine-in Tables & Tabs (v1.26 §F)
// ---------------------------------------------------------------------------

/** What a planned tab job is labelled with on screen. */
function tableLabel(tab: Pick<Tab, 'table'>): string {
  return `Table ${tab.table.name}`;
}

function stationWord(printer: Printer): string {
  return printer.role === 'bar' ? 'Bar' : 'Kitchen';
}

/**
 * After a round's `200`: one kitchen ticket per station, with that round's
 * items only (when `print_kitchen_tickets` is on). The job's `order_ulid` is
 * the **round's** ULID (its `Idempotency-Key`), so each round's first print
 * is deduplicated on its own, like a refund slip.
 */
export function planTabRound(tab: Tab, roundNo: number, roundUlid: string, serverName: string, config: PrintConfig): PrintPlan {
  const items = tab.items.filter((item) => item.round_no === roundNo);
  const routing = routeTicketLines(items, config);
  const sentAt = items[0]?.added_at ?? new Date().toISOString();
  const jobs = routing.tickets.map((ticket) =>
    plannedJob(ticket.printer, config, { kind: 'tab_round', tab, items: ticket.items, roundNo, serverName, sentAt }, {
      kind: 'kitchen',
      orderUlid: roundUlid,
      copyNo: 1,
      isReprint: false,
      label: `${stationWord(ticket.printer)} ticket · ${tableLabel(tab)}, round ${roundNo}`,
    }),
  );
  return { jobs, unrouted: routing.unrouted, manualReceipt: false, notices: [] };
}

/**
 * After a cancel's `200`: a VOID ticket with the cancelled quantity to the
 * item's station (when `print_kitchen_tickets` is on). `order_ulid` is the
 * cancel's `Idempotency-Key`.
 */
export function planTabCancel(tab: Tab, item: TabItem, qty: number, cancelUlid: string, config: PrintConfig): PrintPlan {
  const routing = routeTicketLines([{ ...item, qty }], config);
  const cancelledAt = new Date().toISOString();
  const jobs = routing.tickets.map((ticket) =>
    plannedJob(ticket.printer, config, { kind: 'tab_void', tab, items: ticket.items, cancelledAt }, {
      kind: 'kitchen_void',
      orderUlid: cancelUlid,
      copyNo: 1,
      isReprint: false,
      label: `VOID ${stationWord(ticket.printer).toLowerCase()} ticket · ${tableLabel(tab)}`,
    }),
  );
  return { jobs, unrouted: routing.unrouted, manualReceipt: false, notices: [] };
}

/**
 * **Print bill** on this terminal's receipt printer (`kind: "bill"`). Each
 * print is its own job: `order_ulid` is a new ULID per print, so printing the
 * bill again after another round is never deduplicated away (Q-047).
 */
export function planBill(tab: Tab, config: PrintConfig, receiptPrinterId: number | null, splitCount: number | null, now: number): PrintPlan {
  const printer = chooseReceiptPrinter(config.printers, receiptPrinterId);
  if (!printer) return { jobs: [], unrouted: [], manualReceipt: false, notices: [NO_RECEIPT_PRINTER_MESSAGE] };
  const job = plannedJob(printer, config, { kind: 'bill', tab, printedAt: now, splitCount }, {
    kind: 'bill',
    orderUlid: ulid(),
    copyNo: 1,
    isReprint: false,
    label: `Bill · ${tableLabel(tab)}`,
  });
  return { jobs: [job], unrouted: [], manualReceipt: false, notices: [] };
}

/**
 * An equal split's receipts: one per share, each the full order plus
 * `Share 1 of 3 · ₱415.00 · Cash`. Q-047: share k is sent as `copy_no` k
 * (a receipt takes 1–10) and is a first print, so each share is
 * deduplicated on its own. `receipt_copies` isn't repeated per share.
 */
function shareReceiptJobs(order: PrintableOrder, config: PrintConfig, printer: Printer): PlannedJob[] {
  return receiptShares(order).map((share) =>
    plannedJob(printer, config, { kind: 'receipt', order, copyNo: 1, copies: 1, reprint: false, share }, {
      kind: 'receipt',
      orderUlid: order.ulid,
      copyNo: share.number,
      isReprint: false,
      label: `Receipt #${order.queue_no} · share ${share.number} of ${share.of}`,
    }),
  );
}

/** A tab settlement's first prints: the receipt(s) only (§D.6: no kitchen ticket). */
export function planSettlementPrint(order: PrintableOrder, config: PrintConfig, receiptPrinterId: number | null): PrintPlan {
  const printer = chooseReceiptPrinter(config.printers, receiptPrinterId);
  if (!printer) return { jobs: [], unrouted: [], manualReceipt: false, notices: [NO_RECEIPT_PRINTER_MESSAGE] };
  if (!config.settings.auto_print_receipt) return { jobs: [], unrouted: [], manualReceipt: true, notices: [] };
  if ((order.split_count ?? 0) >= 2) return { jobs: shareReceiptJobs(order, config, printer), unrouted: [], manualReceipt: false, notices: [] };
  return { jobs: receiptJobs(order, config, printer, copiesOf(config), false), unrouted: [], manualReceipt: false, notices: [] };
}

/** **Print receipt** after a settlement with auto-print off (the shares of an equal split). */
export function planSettlementManualReceipt(order: PrintableOrder, config: PrintConfig, receiptPrinterId: number | null): PrintPlan {
  if ((order.split_count ?? 0) < 2) return planManualReceipt(order, config, receiptPrinterId);
  const printer = chooseReceiptPrinter(config.printers, receiptPrinterId);
  if (!printer) return { jobs: [], unrouted: [], manualReceipt: false, notices: [NO_RECEIPT_PRINTER_MESSAGE] };
  return { jobs: shareReceiptJobs(order, config, printer), unrouted: [], manualReceipt: false, notices: [] };
}

/** "Not sent to any printer: 2 x Rice Cake, 1 x Hot Dog". */
export function unroutedSentence(items: readonly Pick<OrderItem, 'qty' | 'product_name'>[]): string | null {
  if (items.length === 0) return null;
  return `Not sent to any printer: ${items.map(describeItem).join(', ')}`;
}
