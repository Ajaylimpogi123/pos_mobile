/**
 * The refund slip (docs/api-contract.md → Voids & Refunds (Phase 7) →
 * Printing → Refund slip): receipt printer, 1 copy, printed after a refund's
 * `201` and reprintable from the order detail.
 *
 * ```
 * <header lines>
 * REFUND                       (centred, double size)
 * No.        INV-MAIN-00000042
 * Refunded   09/27/2026 1:10 PM · Carla Cashier
 * Approved by Marco Manager
 * Reason     Wrong drink
 * --------------------------------
 * 1 x Iced Tea              33.69
 * --------------------------------
 * TOTAL REFUND            P33.69
 * Cash                      33.69
 * GCash 1012345678901        0.00   (per refund payment)
 * VATable sales / VAT 12% / VAT-exempt sales (from the Refund)
 * <footer lines>
 * ```
 * Every amount is a field of the server's `Refund`; nothing is computed here.
 *
 * The VATable / VAT / VAT-exempt pairs print only while `SHOW_VAT_BREAKDOWN`
 * is on (`constants/features.ts`; off until BIR accreditation).
 */
import { showVatBreakdown } from '@/constants/features';
import { formatPercentValue } from '@/sale/discountRules';
import { orderNumberLabel } from '@/sale/localOrder';
import { VAT_RATE_BPS } from '@/sale/pricing';
import type { Order, Refund } from '@/services/types';
import { formatAmount, formatPeso } from '@/utils/money';

import { EscPosBuilder } from '../escpos/builder';
import { formatPrintedDateTime } from './format';
import { footer, header, RECEIPT_LABEL_WIDTH, REPRINT_MARK, type ReceiptSettings } from './receipt';

/** What a refund slip prints (stored as JSON in the print job). */
export type RefundSlipDocument = {
  /** The order after the refund (its invoice number). */
  order: Pick<Order, 'ulid' | 'invoice_no' | 'order_no' | 'queue_no'>;
  refund: Refund;
};

export type RefundSlipOptions = {
  settings: ReceiptSettings;
  columns: number;
  timeZone: string;
  reprint?: boolean;
};

/** The refund slip, as ESC/POS bytes ending in a cut. */
export function buildRefundSlip(doc: RefundSlipDocument, options: RefundSlipOptions): Uint8Array {
  const { refund } = doc;
  const builder = new EscPosBuilder(options.columns).init();
  header(builder, options.settings.receipt_header_lines);

  builder.align('center').size(2, 2).line('REFUND').size(1, 1).align('left');
  if (options.reprint) builder.align('center').line(REPRINT_MARK).align('left');
  builder
    .keyValue('No.', orderNumberLabel(doc.order), RECEIPT_LABEL_WIDTH)
    .keyValue('Refunded', `${formatPrintedDateTime(refund.refunded_at, options.timeZone)} · ${refund.refunded_by.name}`, RECEIPT_LABEL_WIDTH);
  if (refund.authorized_by) builder.keyValue('Approved by', refund.authorized_by.name, RECEIPT_LABEL_WIDTH);
  builder.keyValue('Reason', refund.reason, RECEIPT_LABEL_WIDTH);
  builder.divider();

  for (const item of refund.items) builder.pair(`${item.qty} x ${item.product_name}`, formatAmount(item.amount_cents));
  builder.divider();

  builder.bold(true).size(1, 2).pair('TOTAL REFUND', formatPeso(refund.amount_cents)).size(1, 1).bold(false);
  for (const payment of refund.payments) {
    if (payment.method === 'gcash') {
      builder.pair(payment.reference_no ? `GCash ${payment.reference_no}` : 'GCash', formatAmount(payment.amount_cents));
    } else {
      builder.pair('Cash', formatAmount(payment.amount_cents));
    }
  }
  const showVat = showVatBreakdown();
  // No separator before an empty tail (VAT hidden and no footer lines).
  if (showVat || options.settings.receipt_footer_lines.length > 0) builder.divider();
  if (showVat) {
    builder
      .pair('VATable sales', formatAmount(refund.vatable_sales_cents))
      .pair(`VAT ${formatPercentValue(VAT_RATE_BPS)}`, formatAmount(refund.vat_amount_cents))
      .pair('VAT-exempt sales', formatAmount(refund.vat_exempt_sales_cents));
  }

  footer(builder, options.settings.receipt_footer_lines);
  return builder.cut().build();
}
