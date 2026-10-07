/**
 * The shift reports (docs/api-contract.md → Shifts & Reporting → Device rules
 * → Reports on the tablet): document kinds `x_read` (any time while the shift
 * is open) and `z_read` (printed when it closes, reprintable), on the
 * receipt printer at 32 or 48 columns. **Internal shift reports, not BIR
 * readings**: no grand total, no reset counter.
 *
 * Every figure is a field of the `ShiftReport` (the tablet's own, or the
 * server's from the Shifts screen), formatted with `formatAmount`; nothing is
 * computed here. The layout is the one agreed in Q-014.
 */
import { paymentMethodLabel } from '@/sale/payments';
import { VAT_RATE_BPS } from '@/sale/pricing';
import { formatPercentValue } from '@/sale/discountRules';
import type { IsoDateTime, ShiftReport, UserRef } from '@/services/types';
import { cashRefundsOf } from '@/shifts/shiftReport';
import { formatAmount } from '@/utils/money';

import { EscPosBuilder } from '../escpos/builder';
import { formatPrintedDateTime } from './format';
import { REPRINT_MARK } from './receipt';

export type ShiftReadKind = 'x_read' | 'z_read';

/** What an X-read or Z-read prints (stored as JSON in the print job). */
export type ShiftReadDocument = {
  kind: ShiftReadKind;
  shift: {
    ulid: string;
    /** The tablet's code (`T01`), when known. */
    deviceCode: string | null;
    openedAt: IsoDateTime;
    openedBy: UserRef;
    openingFloatCents: number;
    closedAt: IsoDateTime | null;
    closedBy: UserRef | null;
    countedCashCents: number | null;
    closeNote: string | null;
  };
  report: ShiftReport;
  /** When the report was taken (ISO 8601 UTC). */
  printedAt: IsoDateTime;
  /** The branch name, printed at the top. */
  branchName: string | null;
};

export type ShiftReadOptions = {
  /** Characters per line (32 or 48). */
  columns: number;
  /** The branch's IANA timezone. */
  timeZone: string;
  reprint?: boolean;
};

const LABEL_WIDTH = 11;

/** "Short", "Over" or "Balanced" for a variance. */
export function varianceWord(varianceCents: number): string {
  if (varianceCents < 0) return 'Short';
  if (varianceCents > 0) return 'Over';
  return 'Balanced';
}

function section(builder: EscPosBuilder, title: string): void {
  builder.divider().bold(true).line(title).bold(false);
}

export function buildShiftRead(doc: ShiftReadDocument, options: ShiftReadOptions): Uint8Array {
  const { report, shift } = doc;
  const builder = new EscPosBuilder(options.columns).init();
  const time = (iso: string) => formatPrintedDateTime(iso, options.timeZone);

  builder.align('center');
  if (doc.branchName) builder.bold(true).wrapped(doc.branchName).bold(false);
  builder.size(2, 2).line(doc.kind === 'z_read' ? 'Z-READ' : 'X-READ').size(1, 1);
  builder.line('SHIFT REPORT');
  builder.wrapped('For internal use. Not a BIR reading.');
  if (options.reprint) builder.line(REPRINT_MARK);
  builder.align('left');

  if (shift.deviceCode) builder.keyValue('Tablet', shift.deviceCode, LABEL_WIDTH);
  builder.keyValue('Opened', time(shift.openedAt), LABEL_WIDTH).keyValue('Opened by', shift.openedBy.name, LABEL_WIDTH);
  if (shift.closedAt) builder.keyValue('Closed', time(shift.closedAt), LABEL_WIDTH);
  if (shift.closedBy) builder.keyValue('Closed by', shift.closedBy.name, LABEL_WIDTH);
  if (doc.kind === 'x_read') builder.keyValue('Printed', time(doc.printedAt), LABEL_WIDTH);

  section(builder, 'SALES');
  builder
    .pair('Orders', String(report.orders_count))
    .pair('Items sold', String(report.items_sold))
    .pair('Gross sales', formatAmount(report.gross_sales_cents))
    .pair('Discounts', formatAmount(-report.discounts_cents));
  // Layout as agreed in Q-023. Senior Citizen / PWD Discount: after Discounts (which include them), `SC/PWD (N)`, `VAT exempted` (when not 0) and `SC/PWD discount`.
  builder.line(`  SC/PWD (${report.sc_pwd_orders_count ?? 0})`);
  if ((report.sc_pwd_vat_relief_cents ?? 0) !== 0) builder.pair('  VAT exempted', formatAmount(-(report.sc_pwd_vat_relief_cents ?? 0)));
  builder
    .pair('  SC/PWD discount', formatAmount(-(report.sc_pwd_discount_cents ?? 0)))
    .bold(true)
    .pair('Net sales', formatAmount(report.net_sales_cents))
    .bold(false)
    .pair('VATable sales', formatAmount(report.vatable_sales_cents))
    .pair(`VAT ${formatPercentValue(VAT_RATE_BPS)}`, formatAmount(report.vat_amount_cents))
    .pair('VAT-exempt sales', formatAmount(report.vat_exempt_sales_cents));

  // Voids & Refunds (Phase 7): right after the sales section, after a divider with no heading (Q-017).
  builder
    .divider()
    .pair(`Voids (${report.voids_count ?? 0})`, formatAmount(report.voids_cents ?? 0))
    .pair(`Refunds (${report.refunds_count ?? 0})`, formatAmount(report.refunds_cents ?? 0))
    .bold(true)
    .pair('Net after refunds', formatAmount(report.net_after_refunds_cents ?? report.net_sales_cents))
    .bold(false);

  section(builder, 'PAYMENTS');
  for (const method of report.by_payment_method) {
    builder.pair(`${paymentMethodLabel(method.method)} (${method.orders_count})`, formatAmount(method.amount_cents));
  }

  section(builder, 'CASH DRAWER');
  const cashSales = report.by_payment_method.find((method) => method.method === 'cash')?.amount_cents ?? 0;
  builder
    .pair('Opening float', formatAmount(shift.openingFloatCents))
    .pair('Cash sales', formatAmount(cashSales))
    .pair('Cash in', formatAmount(report.cash_in_cents))
    .pair('Cash out', formatAmount(-report.cash_out_cents))
    // Phase 7: cash handed back for refunds in this shift.
    .pair('Cash refunds', formatAmount(-cashRefundsOf(report)))
    .bold(true)
    .pair('Expected cash', formatAmount(report.expected_cash_cents))
    .bold(false);
  if (shift.countedCashCents !== null) builder.pair('Counted cash', formatAmount(shift.countedCashCents));
  if (report.variance_cents !== null) {
    builder.bold(true).pair(`Variance (${varianceWord(report.variance_cents)})`, formatAmount(report.variance_cents)).bold(false);
  }

  if (report.by_cashier.length > 0) {
    section(builder, 'CASHIERS');
    for (const cashier of report.by_cashier) {
      builder.pair(`${cashier.name} (${cashier.orders_count})`, formatAmount(cashier.net_sales_cents));
    }
  }

  if (report.needs_review_count > 0 || shift.closeNote) builder.divider();
  if (report.needs_review_count > 0) builder.pair('Sales to review', String(report.needs_review_count));
  if (shift.closeNote) builder.wrapped(`Note: ${shift.closeNote}`, 2);

  return builder.cut().build();
}
