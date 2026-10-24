/**
 * A print job's bytes (Web POS §F): the same documents as the tablet
 * (`@pos/core/printing/documents/*`, shared with the tablet), built from the
 * server's `Order` and the **current** print config (the printer's width and
 * name, the receipt lines, the branch timezone).
 *
 * Only the input differs from the tablet's `render.ts`: the tablet renders a
 * stored SQLite queue row at send time; the web terminal renders once, when
 * the job is created, and the server keeps the bytes (`payload_base64`), so a
 * Retry resends exactly what was rendered.
 */
import type { Order, OrderItem, PrintableOrder, PrintConfig, Printer, Tab, TabItem } from '@/services/types';

import { buildBill } from '@pos/core/printing/documents/bill';
import { buildKitchenTicket, buildTabRoundTicket } from '@pos/core/printing/documents/kitchenTicket';
import { buildKitchenVoid, buildTabKitchenVoid } from '@pos/core/printing/documents/kitchenVoid';
import { buildReceipt, buildReceiptSample, type ReceiptSettings, type ReceiptShare } from '@pos/core/printing/documents/receipt';
import { buildRefundSlip, type RefundSlipDocument } from '@pos/core/printing/documents/refundSlip';
import { buildShiftRead, type ShiftReadDocument } from '@pos/core/printing/documents/shiftRead';
import { buildTestPage } from '@pos/core/printing/documents/testPage';
import { buildVoidSlip } from '@pos/core/printing/documents/voidSlip';
import { columnsFor } from '@pos/core/printing/escpos/layout';

export type RenderSpec =
  | { kind: 'receipt'; order: PrintableOrder; copyNo: number; copies: number; reprint: boolean; share?: ReceiptShare }
  | { kind: 'kitchen'; order: PrintableOrder; items: readonly OrderItem[]; reprint: boolean }
  | { kind: 'test'; now: number }
  | { kind: 'receipt_sample'; now: number; settings?: ReceiptSettings }
  // Shifts & Reporting (Phase 6): the X-read and the Z-read of a server `Shift`.
  | { kind: 'shift_read'; doc: ShiftReadDocument; reprint: boolean }
  // Voids & Refunds (Phase 7): from the server's `Order` (and `Refund`).
  | { kind: 'void_slip'; order: Order; reprint: boolean }
  | { kind: 'kitchen_void'; order: Order; items: readonly OrderItem[]; reprint: boolean }
  | { kind: 'refund_slip'; doc: RefundSlipDocument; reprint: boolean }
  // Dine-in Tables & Tabs §F: a round's kitchen ticket, a cancelled item's VOID ticket, and the bill.
  | { kind: 'tab_round'; tab: Tab; items: readonly TabItem[]; roundNo: number; serverName: string; sentAt: string }
  | { kind: 'tab_void'; tab: Tab; items: readonly TabItem[]; cancelledAt: string }
  | { kind: 'bill'; tab: Tab; printedAt: number; splitCount: number | null };

export function renderJob(spec: RenderSpec, config: PrintConfig, printer: Printer): Uint8Array {
  const columns = columnsFor(printer.paper_width_mm);
  const timeZone = config.branch.timezone;

  switch (spec.kind) {
    case 'receipt':
      return buildReceipt(spec.order, {
        settings: config.settings,
        columns,
        timeZone,
        reprint: spec.reprint,
        copy: { number: spec.copyNo, of: spec.copies },
        serviceChargeBps: config.settings.service_charge_bps,
        share: spec.share,
      });
    case 'kitchen':
      return buildKitchenTicket(spec.order, {
        printerName: printer.name,
        items: spec.items,
        columns,
        timeZone,
        reprint: spec.reprint,
      });
    case 'test':
      return buildTestPage(printer, { timeZone, now: spec.now });
    case 'receipt_sample':
      return buildReceiptSample(spec.settings ?? config.settings, { columns, timeZone, now: spec.now });
    case 'shift_read':
      return buildShiftRead(spec.doc, { columns, timeZone, reprint: spec.reprint });
    case 'void_slip':
      return buildVoidSlip(spec.order, { settings: config.settings, columns, timeZone, reprint: spec.reprint });
    case 'kitchen_void':
      return buildKitchenVoid(spec.order, { printerName: printer.name, items: spec.items, columns, timeZone, reprint: spec.reprint });
    case 'refund_slip':
      return buildRefundSlip(spec.doc, { settings: config.settings, columns, timeZone, reprint: spec.reprint });
    case 'tab_round':
      return buildTabRoundTicket(spec.tab, {
        printerName: printer.name,
        items: spec.items,
        roundNo: spec.roundNo,
        serverName: spec.serverName,
        sentAt: spec.sentAt,
        columns,
        timeZone,
      });
    case 'tab_void':
      return buildTabKitchenVoid(spec.tab, { printerName: printer.name, items: spec.items, cancelledAt: spec.cancelledAt, columns, timeZone });
    case 'bill':
      return buildBill(spec.tab, {
        settings: config.settings,
        columns,
        timeZone,
        printedAt: spec.printedAt,
        serviceChargeBps: config.settings.service_charge_bps,
        splitCount: spec.splitCount,
      });
  }
}

/** The bytes as base64 for `payload_base64` (chunked, so a large ticket never overflows the call stack). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
