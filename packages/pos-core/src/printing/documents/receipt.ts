/**
 * The customer's sales receipt (docs/api-contract.md → Printing → Receipt
 * layout). A **sales receipt, not an official receipt**: editable header and
 * footer lines, the full VAT breakdown, no BIR fields.
 *
 * VAT display: the `VATable sales` / `VAT 12%` / `VAT-exempt sales` pairs and
 * the items' `VAT-exempt` detail print only while `SHOW_VAT_BREAKDOWN` is on
 * (`constants/features.ts`; off until BIR accreditation, so for now this is a
 * temporary internal receipt). The SC/PWD `VAT exempted (SC/PWD)` deduction
 * always prints: it changes the amount paid.
 *
 * Every amount is a field of the server's `Order` (or of the local order of
 * an offline sale, built from the same pricing), formatted with
 * `formatAmount`; nothing is computed here.
 *
 * Senior Citizen / PWD Discount adds: `  SC/PWD` under each SC/PWD line; after
 * the subtotal `VAT exempted (SC/PWD)` (only when `vat_exempt`) and
 * `SC/PWD discount 20%`; before the footer one `Senior citizen  ID …` (or
 * `PWD  ID …`) line per person, `Shared by 4 diners, 1 SC/PWD` (headcount
 * mode) and a signature line.
 *
 * Dine-in Tables & Tabs §F adds: a `Service charge (10%)` row before the
 * total when `service_charge_cents > 0`, and for an equal split one receipt
 * per share, each with the full order plus `Share 1 of 3 · ₱415.00 · Cash`.
 */
import { showVatBreakdown } from '../../features';
import { SC_PWD_RATE_BPS, VAT_RATE_BPS } from '../../sale/pricing';
import { personTypeLabel, sharedMealLine } from '../../sale/scPwd';
import { paymentMethodLabel } from '../../sale/payments';
import { equalSplitShares } from '../../sale/serviceCharge';
import { formatPercentValue } from '../../sale/discountRules';
import { orderNumberLabel, ticketNumberLabel } from '../../sale/orderNumbers';
import type { BranchSettings, OrderItem, OrderPayment, OrderScPwd, PaymentMethod, PrintableOrder } from '../../contract/types';
import { formatAmount, formatPeso } from '../../money';

import { EscPosBuilder } from '../escpos/builder';
import { formatPrintedDateTime, formatPrintedDateTimeAt, printedDiscountLabel } from './format';

/** Width of the label column (`No.`, `Date`, `Cashier`, `Customer`). */
export const RECEIPT_LABEL_WIDTH = 11;

/** Width of the SC/PWD person label column (`Senior citizen` + 2 spaces). */
const SC_PWD_LABEL_WIDTH = 16;

export const REPRINT_MARK = '*** REPRINT ***';

export type ReceiptSettings = Pick<BranchSettings, 'receipt_header_lines' | 'receipt_footer_lines'>;

export type ReceiptOptions = {
  settings: ReceiptSettings;
  /** Characters per line (32 or 48). */
  columns: number;
  /** The branch's IANA timezone. */
  timeZone: string;
  reprint?: boolean;
  /** "Copy 2 of 2" prints only when `of` > 1. */
  copy?: { number: number; of: number };
  /** Dine-in: the branch's `service_charge_bps`, for the `Service charge (10%)` label (without it: `Service charge`). */
  serviceChargeBps?: number;
  /** Dine-in (T2): the equal-split share this receipt is for (`receiptShares`). */
  share?: ReceiptShare;
};

/** One share of an equally split order: `Share 1 of 3 · ₱415.00 · Cash`. */
export type ReceiptShare = { number: number; of: number; amountCents: number; method: PaymentMethod };

/**
 * The shares of an equally split order (one receipt each), in share order:
 * share `k` = `floor(total / N)` + 1 centavo for `k ≤ total mod N`, paid by
 * `payments[k − 1]`. `[]` when the order isn't split.
 */
export function receiptShares(order: Pick<PrintableOrder, 'split_count' | 'total_cents' | 'payments'>): ReceiptShare[] {
  const count = order.split_count ?? 0;
  if (count < 2) return [];
  return equalSplitShares(order.total_cents, count).map((amountCents, index) => ({
    number: index + 1,
    of: count,
    amountCents,
    method: order.payments[index]?.method ?? 'cash',
  }));
}

/** `Share 1 of 3 · ₱415.00 · Cash`. */
export function shareLine(share: ReceiptShare): string {
  return `Share ${share.number} of ${share.of} · ${formatPeso(share.amountCents)} · ${paymentMethodLabel(share.method)}`;
}

/** `Service charge (10%)`, or `Service charge` when the rate isn't known. */
export function serviceChargeLabel(bps: number | null | undefined): string {
  return bps && bps > 0 ? `Service charge (${formatPercentValue(bps)})` : 'Service charge';
}

/** The receipt header lines, centred, the first one bold (the void and refund slips use them too). */
export function header(builder: EscPosBuilder, lines: readonly string[]): void {
  builder.align('center');
  lines.forEach((line, index) => {
    if (index === 0) builder.bold(true);
    builder.wrapped(line);
    if (index === 0) builder.bold(false);
  });
  builder.align('left');
}

/** The receipt footer lines, centred. */
export function footer(builder: EscPosBuilder, lines: readonly string[]): void {
  if (lines.length === 0) return;
  builder.align('center');
  for (const line of lines) builder.wrapped(line);
  builder.align('left');
}

/** A line as on the receipt: qty x name and its gross, then @unit / VAT-exempt (only with `SHOW_VAT_BREAKDOWN`), `  SC/PWD` (Senior Citizen / PWD Discount) and its line discount. */
export function itemRows(builder: EscPosBuilder, item: OrderItem): void {
  builder.pair(`${item.qty} x ${item.product_name}`, formatAmount(item.gross_cents));
  const details: string[] = [];
  if (item.qty > 1) details.push(`@${formatAmount(item.unit_price_cents)}`);
  if (!item.is_vatable && showVatBreakdown()) details.push('VAT-exempt');
  if (details.length > 0) builder.wrapped(`  ${details.join(' ')}`, 4);
  // As agreed in Q-023: literal `items[].sc_pwd`, so in headcount mode every line with a share is marked.
  if (item.sc_pwd) builder.line('  SC/PWD');
  if (item.discount && item.line_discount_cents > 0) {
    builder.pair(`  ${printedDiscountLabel(item.discount)}`, formatAmount(-item.line_discount_cents));
  }
}

/** The SC/PWD amounts after the subtotal: `VAT exempted (SC/PWD)` (only when `vat_exempt`) and `SC/PWD discount 20%`. */
export function scPwdAmountRows(builder: EscPosBuilder, scPwd: OrderScPwd | null | undefined): void {
  if (!scPwd) return;
  if (scPwd.vat_exempt) builder.pair('VAT exempted (SC/PWD)', formatAmount(-scPwd.vat_relief_cents));
  builder.pair(`SC/PWD discount ${formatPercentValue(SC_PWD_RATE_BPS)}`, formatAmount(-scPwd.discount_cents));
}

/** Before the footer: one ID line per person, the shared-meal line (headcount mode) and the signature line. */
function scPwdPersonRows(builder: EscPosBuilder, scPwd: OrderScPwd | null | undefined): void {
  if (!scPwd) return;
  // `Senior citizen  ID OSCA-12345`: the label column fits "Senior citizen" plus two spaces; a long ID wraps under it.
  for (const person of scPwd.persons) builder.keyValue(personTypeLabel(person.type), `ID ${person.id_no}`, SC_PWD_LABEL_WIDTH);
  if (scPwd.mode === 'headcount') builder.wrapped(sharedMealLine(scPwd.diners ?? scPwd.persons.length, scPwd.persons.length));
  const label = 'Signature: ';
  builder.line(label + '_'.repeat(Math.max(8, builder.columns - label.length - 1)));
}

function paymentRow(builder: EscPosBuilder, payment: OrderPayment): void {
  if (payment.method === 'gcash') {
    builder.pair(payment.reference_no ? `GCash ${payment.reference_no}` : 'GCash', formatAmount(payment.amount_cents));
  } else {
    // Cash prints what was handed over; the change follows.
    builder.pair('Cash', formatAmount(payment.tendered_cents ?? payment.amount_cents));
  }
}

/** The receipt for `order`, as ESC/POS bytes ending in a cut. */
export function buildReceipt(order: PrintableOrder, options: ReceiptOptions): Uint8Array {
  const builder = new EscPosBuilder(options.columns).init();
  header(builder, options.settings.receipt_header_lines);

  builder.line('SALES RECEIPT');
  if (options.reprint) builder.line(REPRINT_MARK);
  builder
    // Offline Sales: a local order (no invoice number yet) prints `No. T01-20260926-0005 (offline)`.
    .keyValue('No.', orderNumberLabel(order), RECEIPT_LABEL_WIDTH)
    .keyValue('Date', formatPrintedDateTime(order.placed_at, options.timeZone), RECEIPT_LABEL_WIDTH)
    .keyValue('Cashier', order.cashier.name, RECEIPT_LABEL_WIDTH);
  if (order.customer) builder.keyValue('Customer', order.customer.full_name, RECEIPT_LABEL_WIDTH);

  // Q-010 (resolved): a local order prints the kitchen ticket's number, `QUEUE T01-5`; online orders `QUEUE #17`.
  builder.align('center').size(2, 2).line(`QUEUE ${ticketNumberLabel(order)}`).size(1, 1).align('left');
  // Table Number (Core Sale revision 2): right after the queue line, only when set.
  if (order.table_no) builder.keyValue('Table', order.table_no, RECEIPT_LABEL_WIDTH);
  builder.divider();

  for (const item of order.items) itemRows(builder, item);
  builder.divider();

  builder.pair('Subtotal', formatAmount(order.subtotal_cents));
  scPwdAmountRows(builder, order.sc_pwd);
  if (order.order_discount) {
    builder.pair(`Order discount (${printedDiscountLabel(order.order_discount)})`, formatAmount(-order.order_discount.amount_cents));
  }
  // Dine-in §F: the service charge, before the total (an order stored before Dine-in has none).
  if ((order.service_charge_cents ?? 0) > 0) {
    builder.pair(serviceChargeLabel(options.serviceChargeBps), formatAmount(order.service_charge_cents));
  }
  builder.bold(true).size(1, 2).pair('TOTAL', formatPeso(order.total_cents)).size(1, 1).bold(false);
  for (const payment of order.payments) paymentRow(builder, payment);
  builder.pair('Change', formatAmount(order.change_cents));
  if (options.share) builder.bold(true).wrapped(shareLine(options.share)).bold(false);

  const showVat = showVatBreakdown();
  const copyLine = options.copy !== undefined && options.copy.of > 1;
  // No separator before an empty tail (VAT hidden, no approver, no SC/PWD, no footer, no copy line).
  if (showVat || order.authorized_by || order.sc_pwd || options.settings.receipt_footer_lines.length > 0 || copyLine) {
    builder.divider();
  }

  if (showVat) {
    builder
      .pair('VATable sales', formatAmount(order.vatable_sales_cents))
      .pair(`VAT ${formatPercentValue(VAT_RATE_BPS)}`, formatAmount(order.vat_amount_cents))
      .pair('VAT-exempt sales', formatAmount(order.vat_exempt_sales_cents));
  }
  if (order.authorized_by) builder.wrapped(`Discount approved by ${order.authorized_by.name}`);
  scPwdPersonRows(builder, order.sc_pwd);

  footer(builder, options.settings.receipt_footer_lines);
  if (options.copy && options.copy.of > 1) builder.line(`Copy ${options.copy.number} of ${options.copy.of}`);
  return builder.cut().build();
}

/**
 * Settings → "Print sample": the header and footer lines as they will print,
 * around a marked sample block. No sale is invented: there are no items or amounts.
 */
export function buildReceiptSample(settings: ReceiptSettings, options: { columns: number; timeZone: string; now: number }): Uint8Array {
  const builder = new EscPosBuilder(options.columns).init();
  header(builder, settings.receipt_header_lines);
  builder
    .line('SALES RECEIPT')
    .line('*** SAMPLE ***')
    .keyValue('Date', formatPrintedDateTimeAt(options.now, options.timeZone), RECEIPT_LABEL_WIDTH)
    .divider()
    .wrapped('Sale details print here.')
    .divider();
  footer(builder, settings.receipt_footer_lines);
  return builder.cut().build();
}
