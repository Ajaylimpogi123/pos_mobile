/**
 * The void slip (docs/api-contract.md → Voids & Refunds (Phase 7) → Printing
 * → Void slip): receipt printer, 1 copy, printed after a void's `200` and
 * reprintable from the order detail.
 *
 * ```
 * <header lines>
 * *** VOID ***                 (centred, double size)
 * No.        INV-MAIN-00000042
 * Sold       09/25/2026 12:12 PM · Carla Cashier
 * Voided     09/25/2026 12:20 PM · Carla Cashier
 * Approved by Marco Manager    (when void_authorized_by)
 * Reason     Customer cancelled
 * --------------------------------
 * <the lines as on the receipt>
 * TOTAL VOIDED            P257.00
 * Cash returned           157.00   (cash amount_cents)
 * GCash to return         100.00   (per GCash payment, with its reference)
 * ```
 * Every amount is a field of the server's `Order`; nothing is computed here.
 */
import { orderNumberLabel } from '@/sale/localOrder';
import type { Order } from '@/services/types';
import { formatAmount, formatPeso } from '@/utils/money';

import { EscPosBuilder } from '../escpos/builder';
import { formatPrintedDateTime, printedDiscountLabel } from './format';
import { header, itemRows, RECEIPT_LABEL_WIDTH, REPRINT_MARK, scPwdAmountRows, type ReceiptSettings } from './receipt';

export type VoidSlipOptions = {
  settings: ReceiptSettings;
  columns: number;
  timeZone: string;
  reprint?: boolean;
};

/** "09/25/2026 12:12 PM · Carla Cashier". */
function whenBy(iso: string | null, name: string | undefined, timeZone: string): string {
  const time = iso ? formatPrintedDateTime(iso, timeZone) : '';
  return [time, name ?? ''].filter((part) => part !== '').join(' · ');
}

/** The void slip of a voided `Order`, as ESC/POS bytes ending in a cut. */
export function buildVoidSlip(order: Order, options: VoidSlipOptions): Uint8Array {
  const builder = new EscPosBuilder(options.columns).init();
  header(builder, options.settings.receipt_header_lines);

  builder.align('center').size(2, 2).line('*** VOID ***').size(1, 1).align('left');
  if (options.reprint) builder.align('center').line(REPRINT_MARK).align('left');
  builder
    .keyValue('No.', orderNumberLabel(order), RECEIPT_LABEL_WIDTH)
    .keyValue('Sold', whenBy(order.placed_at, order.cashier.name, options.timeZone), RECEIPT_LABEL_WIDTH)
    .keyValue('Voided', whenBy(order.voided_at, order.voided_by?.name, options.timeZone), RECEIPT_LABEL_WIDTH);
  if (order.void_authorized_by) builder.keyValue('Approved by', order.void_authorized_by.name, RECEIPT_LABEL_WIDTH);
  if (order.void_reason) builder.keyValue('Reason', order.void_reason, RECEIPT_LABEL_WIDTH);
  builder.divider();

  for (const item of order.items) itemRows(builder, item);
  // Senior Citizen / PWD Discount: its rows keep the lines adding up to the total too (as agreed in Q-023).
  scPwdAmountRows(builder, order.sc_pwd);
  // Q-017: the order discount row keeps the lines adding up to the total.
  if (order.order_discount) {
    builder.pair(`Order discount (${printedDiscountLabel(order.order_discount)})`, formatAmount(-order.order_discount.amount_cents));
  }
  builder.bold(true).pair('TOTAL VOIDED', formatPeso(order.total_cents)).bold(false);

  const cash = order.payments.filter((payment) => payment.method === 'cash');
  if (cash.length > 0) {
    builder.pair('Cash returned', formatAmount(cash.reduce((sum, payment) => sum + payment.amount_cents, 0)));
  }
  for (const payment of order.payments) {
    if (payment.method !== 'gcash') continue;
    builder.pair('GCash to return', formatAmount(payment.amount_cents));
    // Q-017: the reference prints on the line under its amount.
    if (payment.reference_no) builder.wrapped(`  Ref ${payment.reference_no}`, 4);
  }
  return builder.cut().build();
}
