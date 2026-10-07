/**
 * A queued job's bytes, built at send time from the job's stored order (the
 * server's `Order`, or the local order of an offline sale)
 * and the **current** config: the printer's width and name, the receipt
 * lines, the branch timezone.
 */
import type { PrintJobRow } from '@/db/schema';
import { withReversalDefaults } from '@/sale/refunds';
import type { Order, PrintableOrder, PrintConfig, Printer } from '@/services/types';

import { buildKitchenTicket } from './documents/kitchenTicket';
import { buildKitchenVoid } from './documents/kitchenVoid';
import { buildReceipt } from './documents/receipt';
import { buildRefundSlip, type RefundSlipDocument } from './documents/refundSlip';
import { buildShiftRead, type ShiftReadDocument } from './documents/shiftRead';
import { buildVoidSlip } from './documents/voidSlip';
import { columnsFor } from './escpos/layout';

function parseItemIds(text: string | null): number[] {
  if (!text) return [];
  const value: unknown = JSON.parse(text);
  return Array.isArray(value) ? value.filter((id): id is number => typeof id === 'number') : [];
}

export function renderJob(job: PrintJobRow, config: PrintConfig, printer: Printer): Uint8Array {
  const columns = columnsFor(printer.paper_width_mm);
  const timeZone = config.branch.timezone;

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
    return buildReceipt(order, {
      settings: config.settings,
      columns,
      timeZone,
      reprint: job.is_reprint,
      copy: { number: job.copy_no, of: job.copies },
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
