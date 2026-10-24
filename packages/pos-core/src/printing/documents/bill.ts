/**
 * The printed bill (docs/api-contract.md → Dine-in Tables & Tabs → §F), sent
 * to the receipt printer (print-job `kind: "bill"` on web terminals). It is
 * **not a receipt**: nothing is paid yet.
 *
 * ```
 * <header lines>
 * BILL - NOT A RECEIPT
 * Table      5
 * Guests     3
 * Time       10/13/2026 7:42 PM
 * --------------------------------
 * 2 x Sisig                 450.00
 *   @225.00
 * --------------------------------
 * Subtotal                1,245.00
 * Service charge (10%)      124.50
 * TOTAL                  P1,369.50
 * Split 3 ways: P456.50 each
 * ```
 *
 * The items are the tab's **remaining** quantities, consolidated by product
 * and price (a product sent in two rounds prints once). The amounts are
 * before any checkout discount; the receipt is the record of what was paid.
 */
import { formatAmount, formatPeso } from '../../money';
import { computeServiceCharge, equalSplitShares } from '../../sale/serviceCharge';
import { tabRemainingLines } from '../../sale/tab';
import type { Tab } from '../../contract/types';

import { EscPosBuilder } from '../escpos/builder';
import { formatPrintedDateTimeAt } from './format';
import { header, RECEIPT_LABEL_WIDTH, REPRINT_MARK, serviceChargeLabel, type ReceiptSettings } from './receipt';

export const BILL_TITLE = 'BILL — NOT A RECEIPT';

/** One printed bill line: a product at one price, with its remaining quantity. */
export type BillLine = {
  product_id: number;
  product_name: string;
  unit_price_cents: number;
  qty: number;
  amount_cents: number;
};

/** The tab's remaining items consolidated by `(product_id, unit_price_cents)`, in the order first sent. */
export function billLines(tab: Pick<Tab, 'items'>): BillLine[] {
  const merged = new Map<string, BillLine>();
  for (const item of tabRemainingLines(tab)) {
    const key = `${item.product_id}:${item.unit_price_cents}`;
    const existing = merged.get(key);
    if (existing) {
      existing.qty += item.remaining_qty;
      existing.amount_cents += item.unit_price_cents * item.remaining_qty;
    } else {
      merged.set(key, {
        product_id: item.product_id,
        product_name: item.product_name,
        unit_price_cents: item.unit_price_cents,
        qty: item.remaining_qty,
        amount_cents: item.unit_price_cents * item.remaining_qty,
      });
    }
  }
  return [...merged.values()];
}

/** The bill's figures: subtotal (Σ remaining), service charge (when on) and total. */
export type BillTotals = { subtotal_cents: number; service_charge_cents: number; total_cents: number };

export function billTotals(tab: Pick<Tab, 'items'>, serviceChargeBps: number): BillTotals {
  const subtotal = billLines(tab).reduce((sum, line) => sum + line.amount_cents, 0);
  const serviceCharge = serviceChargeBps > 0 ? computeServiceCharge(subtotal, serviceChargeBps) : 0;
  return { subtotal_cents: subtotal, service_charge_cents: serviceCharge, total_cents: subtotal + serviceCharge };
}

/** `Split 3 ways: ₱456.50 each`; uneven shares list each one (`₱94.24 / ₱94.23 / ₱94.23`). */
export function splitLine(totalCents: number, count: number): string {
  const shares = equalSplitShares(totalCents, count);
  const even = shares.every((share) => share === shares[0]);
  return even
    ? `Split ${count} ways: ${formatPeso(shares[0])} each`
    : `Split ${count} ways: ${shares.map((share) => formatPeso(share)).join(' / ')}`;
}

export type BillOptions = {
  settings: ReceiptSettings;
  /** Characters per line (32 or 48). */
  columns: number;
  /** The branch's IANA timezone. */
  timeZone: string;
  /** When the bill is printed (ms). */
  printedAt: number;
  /** The branch's `service_charge_bps` (0 = none). */
  serviceChargeBps: number;
  /** Optional: the `Split 3 ways: …` line (2–10). */
  splitCount?: number | null;
  reprint?: boolean;
};

/** The bill for `tab`, as ESC/POS bytes ending in a cut. */
export function buildBill(tab: Pick<Tab, 'table' | 'guests' | 'items'>, options: BillOptions): Uint8Array {
  const builder = new EscPosBuilder(options.columns).init();
  header(builder, options.settings.receipt_header_lines);

  builder.bold(true).wrapped(BILL_TITLE).bold(false);
  if (options.reprint) builder.line(REPRINT_MARK);
  builder
    .keyValue('Table', tab.table.name, RECEIPT_LABEL_WIDTH)
    .keyValue('Guests', String(tab.guests), RECEIPT_LABEL_WIDTH)
    .keyValue('Time', formatPrintedDateTimeAt(options.printedAt, options.timeZone), RECEIPT_LABEL_WIDTH);
  builder.divider();

  for (const line of billLines(tab)) {
    builder.pair(`${line.qty} x ${line.product_name}`, formatAmount(line.amount_cents));
    if (line.qty > 1) builder.wrapped(`  @${formatAmount(line.unit_price_cents)}`, 4);
  }
  builder.divider();

  const totals = billTotals(tab, options.serviceChargeBps);
  builder.pair('Subtotal', formatAmount(totals.subtotal_cents));
  if (totals.service_charge_cents > 0) {
    builder.pair(serviceChargeLabel(options.serviceChargeBps), formatAmount(totals.service_charge_cents));
  }
  builder.bold(true).size(1, 2).pair('TOTAL', formatPeso(totals.total_cents)).size(1, 1).bold(false);
  if (options.splitCount && options.splitCount >= 2) builder.wrapped(splitLine(totals.total_cents, options.splitCount));
  return builder.cut().build();
}
