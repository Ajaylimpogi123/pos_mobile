/**
 * A queued job's bytes, built at send time from the job's stored order (the
 * server's `Order`, or the local order of an offline sale)
 * and the **current** config: the printer's width and name, the receipt
 * lines, the branch timezone.
 */
import type { PrintJobRow } from '@/db/schema';
import { withReversalDefaults } from '@pos/core/sale/refunds';
import type { Order, PrintableOrder, PrintConfig, Printer } from '@/services/types';

import { buildBill } from '@pos/core/printing/documents/bill';
import { buildKitchenTicket, buildTabRoundTicket } from '@pos/core/printing/documents/kitchenTicket';
import { buildKitchenVoid, buildTabKitchenVoid } from '@pos/core/printing/documents/kitchenVoid';
import { buildReceipt, receiptShares } from '@pos/core/printing/documents/receipt';
import { computeServiceCharge } from '@pos/core/sale/serviceCharge';
import { buildRefundSlip, type RefundSlipDocument } from '@pos/core/printing/documents/refundSlip';
import { buildShiftRead, type ShiftReadDocument } from '@pos/core/printing/documents/shiftRead';
import { buildVoidSlip } from '@pos/core/printing/documents/voidSlip';
import { columnsFor } from '@pos/core/printing/escpos/layout';

import type { BillDocument, TabRoundDocument, TabVoidDocument } from './tabDocuments';

function parseItemIds(text: string | null): number[] {
  if (!text) return [];
  const value: unknown = JSON.parse(text);
  return Array.isArray(value) ? value.filter((id): id is number => typeof id === 'number') : [];
}

/**
 * The rate to print beside `Service charge` on a receipt: the branch's current
 * `service_charge_bps` when it gives this order's service charge back exactly
 * (`S = rhu(T × bps, 10000)`), else none (the rate changed since).
 */
export function receiptServiceChargeBps(order: Pick<PrintableOrder, 'total_cents' | 'service_charge_cents'>, bps: number): number | undefined {
  const charge = order.service_charge_cents ?? 0;
  if (charge <= 0 || bps <= 0) return undefined;
  return computeServiceCharge(order.total_cents - charge, bps) === charge ? bps : undefined;
}

export function renderJob(job: PrintJobRow, config: PrintConfig, printer: Printer): Uint8Array {
  const columns = columnsFor(printer.paper_width_mm);
  const timeZone = config.branch.timezone;

  // Dine-in Tables & Tabs §F: `order_json` holds the tab document (see `./tabDocuments`).
  if (job.kind === 'tab_round') {
    const doc = JSON.parse(job.order_json) as TabRoundDocument;
    const ids = new Set(parseItemIds(job.item_ids));
    return buildTabRoundTicket(doc.tab, {
      printerName: printer.name,
      items: doc.items.filter((item) => ids.has(item.id)),
      roundNo: doc.round_no,
      serverName: doc.server_name,
      sentAt: doc.sent_at,
      columns,
      timeZone,
      reprint: job.is_reprint,
    });
  }
  if (job.kind === 'tab_void') {
    const doc = JSON.parse(job.order_json) as TabVoidDocument;
    const ids = new Set(parseItemIds(job.item_ids));
    return buildTabKitchenVoid(doc.tab, {
      printerName: printer.name,
      items: doc.items.filter((item) => ids.has(item.id)),
      cancelledAt: doc.cancelled_at,
      columns,
      timeZone,
      reprint: job.is_reprint,
    });
  }
  if (job.kind === 'bill') {
    const doc = JSON.parse(job.order_json) as BillDocument;
    return buildBill(doc.tab, {
      settings: config.settings,
      columns,
      timeZone,
      printedAt: doc.printed_at,
      serviceChargeBps: doc.service_charge_bps,
      splitCount: doc.split_count,
      reprint: job.is_reprint,
    });
  }

  if (job.kind === 'x_read' || job.kind === 'z_read') {
    // Shifts & Reporting (Phase 6): `order_json` holds the shift report document.
    const doc = JSON.parse(job.order_json) as ShiftReadDocument;
    return buildShiftRead({ ...doc, kind: job.kind }, { columns, timeZone, reprint: job.is_reprint });
  }

  if (job.kind === 'refund_slip') {
    // Voids & Refunds (Phase 7): `order_json` holds the refund slip document.
    const doc = JSON.parse(job.order_json) as RefundSlipDocument;
    return buildRefundSlip(doc, { settings: config.settings, columns, timeZone, reprint: job.is_reprint });
  }

  const order = withReversalDefaults(JSON.parse(job.order_json) as PrintableOrder);

  if (job.kind === 'void_slip') {
    return buildVoidSlip(order as Order, { settings: config.settings, columns, timeZone, reprint: job.is_reprint });
  }

  if (job.kind === 'receipt') {
    // Dine-in (T2): an equally split order prints one receipt per share; `copy_no` is the share.
    const share = receiptShares(order)[job.copy_no - 1];
    return buildReceipt(order, {
      settings: config.settings,
      columns,
      timeZone,
      reprint: job.is_reprint,
      copy: share ? undefined : { number: job.copy_no, of: job.copies },
      share,
      serviceChargeBps: receiptServiceChargeBps(order, config.settings.service_charge_bps ?? 0),
    });
  }

  const ids = new Set(parseItemIds(job.item_ids));
  const items = order.items.filter((item) => ids.has(item.id));
  if (job.kind === 'kitchen_void') {
    return buildKitchenVoid(order as Order, { printerName: printer.name, items, columns, timeZone, reprint: job.is_reprint });
  }
  return buildKitchenTicket(order, {
    printerName: printer.name,
    items,
    columns,
    timeZone,
    reprint: job.is_reprint,
  });
}
