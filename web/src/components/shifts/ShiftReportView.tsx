/**
 * A server `ShiftReport` on screen (the live X-read, the Z-read and the
 * Shifts detail), with the tablet's sections and wording: sales, voids and
 * refunds, payments, the cash drawer (expected cash, and once counted the
 * variance), the cashiers and the offline sales to review. Every figure is a
 * report field, formatted from integer centavos.
 */
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import type { ShiftReport } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { varianceWord } from '@pos/core/printing/documents/shiftRead';
import { paymentMethodLabel } from '@pos/core/sale/payments';
import { cashRefundsOf } from '@pos/core/shifts/cashRefunds';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

type RowProps = {
  label: string;
  value: string;
  detail?: string;
  variant?: 'default' | 'muted' | 'strong' | 'total';
};

function Row({ label, value, detail, variant = 'default' }: RowProps) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 text-[15px]',
        variant === 'muted' && 'text-sm text-muted-foreground',
        variant === 'strong' && 'font-semibold',
        variant === 'total' && 'border-t border-border pt-1.5 text-base font-bold',
      )}
    >
      <span>
        {label}
        {detail ? <span className="block text-[13px] font-normal text-muted-foreground">{detail}</span> : null}
      </span>
      <span className={cn('tabular', variant === 'total' && 'text-green')}>{value}</span>
    </div>
  );
}

function money(cents: number, deduction = false): string {
  return deduction && cents !== 0 ? `-${formatPeso(cents)}` : formatPeso(cents);
}

function count(value: number): string {
  return value.toLocaleString('en-PH');
}

function plural(value: number, one: string, many: string): string {
  return `${count(value)} ${value === 1 ? one : many}`;
}

/** "Short ₱50.00" / "Over ₱20.00" / "Balanced", in words and colour (the colour is never the only cue). */
export function VarianceLine({ varianceCents, label = 'Variance' }: { varianceCents: number; label?: string }) {
  const word = varianceWord(varianceCents);
  const text = varianceCents === 0 ? word : `${word} ${formatPeso(Math.abs(varianceCents))}`;
  const tone = varianceCents < 0 ? 'text-danger' : varianceCents > 0 ? 'text-warning' : 'text-success';
  return (
    <div className="flex items-baseline justify-between gap-3 text-base font-bold">
      <span>{label}</span>
      <span className={cn('tabular', tone)}>{text}</span>
    </div>
  );
}

type ShiftReportViewProps = {
  report: ShiftReport;
  openingFloatCents: number;
  /** Shown once the drawer was counted (a closed shift). */
  countedCashCents: number | null;
};

export function ShiftReportView({ report, openingFloatCents, countedCashCents }: ShiftReportViewProps) {
  const cashSales = report.by_payment_method.find((method) => method.method === 'cash')?.amount_cents ?? 0;
  const refundsCount = report.refunds_count ?? 0;
  const refundDetail = [
    plural(refundsCount, 'refund', 'refunds'),
    ...(report.refunds_by_method ?? []).map((method) => `${paymentMethodLabel(method.method)} ${formatPeso(method.amount_cents)}`),
  ].join(' · ');

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Section title="Sales">
        <Row label="Orders" value={count(report.orders_count)} />
        <Row label="Items sold" value={count(report.items_sold)} />
        <Row label="Gross sales" value={money(report.gross_sales_cents)} />
        <Row label="Discounts" value={money(report.discounts_cents, true)} />
        {(report.sc_pwd_vat_relief_cents ?? 0) !== 0 ? (
          <Row label="VAT exempted (SC/PWD)" value={money(report.sc_pwd_vat_relief_cents, true)} variant="muted" />
        ) : null}
        <Row
          label="SC/PWD discount"
          detail={plural(report.sc_pwd_orders_count ?? 0, 'SC/PWD sale', 'SC/PWD sales')}
          value={money(report.sc_pwd_discount_cents ?? 0, true)}
          variant="muted"
        />
        {/* Dine-in §G: its own row; net sales (Σ totals) already include it. */}
        <Row label="Service charge" value={money(report.service_charge_cents ?? 0)} variant="muted" />
        <Row label="Net sales" value={money(report.net_sales_cents)} variant="total" />
        <Row label="VATable sales" value={money(report.vatable_sales_cents)} variant="muted" />
        <Row label="VAT" value={money(report.vat_amount_cents)} variant="muted" />
        <Row label="VAT-exempt sales" value={money(report.vat_exempt_sales_cents)} variant="muted" />
      </Section>

      <div className="flex flex-col gap-3">
        <Section title="Voids and refunds">
          <Row label="Voids" detail={plural(report.voids_count ?? 0, 'sale', 'sales')} value={money(report.voids_cents ?? 0)} />
          <Row label="Refunds" detail={refundDetail} value={money(report.refunds_cents ?? 0, true)} />
          <Row label="Net after refunds" value={money(report.net_after_refunds_cents ?? report.net_sales_cents)} variant="total" />
        </Section>

        <Section title="Payments">
          {report.by_payment_method.map((method) => (
            <Row
              key={method.method}
              label={paymentMethodLabel(method.method)}
              detail={`${plural(method.orders_count, 'order', 'orders')}${method.method === 'cash' ? ' · after change' : ''}`}
              value={money(method.amount_cents)}
            />
          ))}
        </Section>
      </div>

      <Section title="Cash drawer">
        <Row label="Opening float" value={money(openingFloatCents)} />
        <Row label="Cash sales (after change)" value={money(cashSales)} />
        <Row label="Cash in" value={money(report.cash_in_cents)} />
        <Row label="Cash out" value={money(report.cash_out_cents, true)} />
        <Row label="Cash refunds" value={money(cashRefundsOf(report), true)} />
        <Row label="Expected cash" value={money(report.expected_cash_cents)} variant="total" />
        {countedCashCents !== null ? <Row label="Counted cash" value={money(countedCashCents)} variant="strong" /> : null}
        {countedCashCents !== null && report.variance_cents !== null ? <VarianceLine varianceCents={report.variance_cents} /> : null}
      </Section>

      <div className="flex flex-col gap-3">
        {report.by_cashier.length > 0 ? (
          <Section title="Cashiers">
            {report.by_cashier.map((cashier) => (
              <Row
                key={cashier.user_id}
                label={cashier.name}
                detail={plural(cashier.orders_count, 'order', 'orders')}
                value={money(cashier.net_sales_cents)}
              />
            ))}
          </Section>
        ) : null}
        <Section title="Offline sales">
          <Row label="Offline sales to review" value={count(report.needs_review_count)} />
        </Section>
      </div>
    </div>
  );
}
