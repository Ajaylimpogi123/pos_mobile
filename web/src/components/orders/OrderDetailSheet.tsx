/**
 * The order detail (back-office.md: a right sheet on web): a receipt-style
 * view of the server's `Order`, its SC/PWD block, the review block (Offline
 * Sales → Review), the void and the refunds, the actions **Void sale** and
 * **Refund** (Voids & Refunds → Device rules, with the shared
 * `reversalGate`: the web terminal is always online and every order it shows
 * is a synced server order), and **Reprint** (receipt, kitchen tickets, void
 * slip, refund slips), marked `*** REPRINT ***`, with each job's print status.
 */
import { BanIcon, PrinterIcon, ReceiptTextIcon, Undo2Icon } from 'lucide-react';

import { useEffect, useRef } from 'react';

import { DetailPanel } from '@/components/common/DetailPanel';
import { ErrorState, LoadingRows } from '@/components/common/ListStates';
import { PrintJobList } from '@/components/printing/PrintJobList';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SHOW_VAT_BREAKDOWN } from '@pos/core/features';
import { useCurrentShift } from '@/hooks/useCurrentShift';
import { useOrderDetail } from '@/hooks/useOrders';
import { useOrderPrinting } from '@/hooks/useOrderPrinting';
import { useRefundOrder } from '@/hooks/useRefundOrder';
import { useVoidOrder } from '@/hooks/useVoidOrder';
import { hasAnyPermission, PERMISSIONS } from '@/utils/permissions';
import { reversalGate, type ReversalAction } from '@pos/core/sale/reversals';
import { cn } from '@/lib/utils';
import { describeDiscount, formatPercentValue } from '@pos/core/sale/discountRules';
import { paymentMethodLabel } from '@pos/core/sale/payments';
import { VAT_RATE_BPS } from '@pos/core/sale/pricing';
import { personTypeLabel, SC_PWD_DISCOUNT_LABEL, scPwdModeLabel, sharedMealLine } from '@pos/core/sale/scPwd';
import type { Order } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatBranchDateTime } from '@pos/core/businessDay';
import { formatPeso } from '@pos/core/money';
import { equalSplitShares } from '@pos/core/sale/serviceCharge';

import { OrderReviewSection } from './OrderReviewSection';
import { NeedsReviewBadge, OrderStatusBadge } from './OrderStatus';
import { RefundDialog } from './RefundDialog';
import { VoidOrderDialog } from './VoidOrderDialog';

/** What the row menu asked for: open the matching flow once the order has loaded. */
export type OrderDetailIntent = 'view' | 'reprint' | 'void' | 'refund';

type OrderDetailSheetProps = {
  ulid: string | null;
  onClose: () => void;
  /** `sheet` at ≥ 1280 px, `page` below (MASTER §6, `useDetailMode`); a sheet by default (e.g. over a detail page). */
  mode?: 'sheet' | 'page';
  intent?: OrderDetailIntent;
  /** The Back button in page mode (default "Back to orders"). */
  backLabel?: string;
};

function Line({ label, value, tone, strong }: { label: string; value: string; tone?: 'danger' | 'muted' | 'green'; strong?: boolean }) {
  return (
    <div
      className={cn(
        'flex justify-between gap-3',
        tone === 'danger' && 'text-danger',
        tone === 'muted' && 'text-muted-foreground',
        strong && 'text-base font-bold',
      )}
    >
      <span>{label}</span>
      <span className={cn('tabular', strong ? 'font-bold' : 'font-medium', tone === 'green' && 'text-green')}>{value}</span>
    </div>
  );
}

export function OrderDetailSheet({ ulid, onClose, mode = 'sheet', intent = 'view', backLabel = 'Back to orders' }: OrderDetailSheetProps) {
  const detail = useOrderDetail(ulid);
  const printing = useOrderPrinting();
  const timezone = useSessionStore((state) => state.user?.branch.timezone ?? 'Asia/Manila');

  return (
    <DetailPanel
      mode={mode}
      open={ulid !== null}
      onClose={() => {
        printing.reset();
        onClose();
      }}
      sheetClassName="sm:max-w-xl"
      backLabel={backLabel}
      title={
        <>
          <ReceiptTextIcon className="size-5" aria-hidden="true" />
          {detail.order ? detail.order.invoice_no : 'Order'}
        </>
      }
      description={detail.order ? `${formatBranchDateTime(detail.order.placed_at, timezone) ?? detail.order.placed_at} · ${detail.order.cashier.name}` : 'Loading…'}
    >
      {detail.loading ? (
        <LoadingRows rows={6} label="Loading the order…" />
      ) : detail.error ? (
        <ErrorState message={detail.error} onRetry={detail.reload} />
      ) : detail.order ? (
        <OrderBody key={`${detail.order.ulid}-${intent}`} order={detail.order} timezone={timezone} printing={printing} refetch={detail.refetch} intent={intent} />
      ) : null}
    </DetailPanel>
  );
}

type OrderBodyProps = {
  order: Order;
  timezone: string;
  printing: ReturnType<typeof useOrderPrinting>;
  refetch: () => Promise<unknown>;
  intent: OrderDetailIntent;
};

function ActionMessage({ action }: { action: ReversalAction | null }) {
  return action?.message ? <p className="text-[13px] text-muted-foreground">{action.message}</p> : null;
}

function OrderBody({ order, timezone, printing, refetch, intent }: OrderBodyProps) {
  const regularDiscount = order.line_discounts_cents + (order.order_discount?.amount_cents ?? 0);
  const user = useSessionStore((state) => state.user);
  const shift = useCurrentShift();
  const voiding = useVoidOrder(order);
  const refunding = useRefundOrder(order, { refetch });
  // The web terminal is online only, and every order here is a synced server order.
  const gate = reversalGate({
    order,
    unsynced: false,
    online: true,
    currentShiftUlid: shift.shift?.ulid ?? null,
    shiftLoading: shift.loading,
    canVoid: hasAnyPermission(user, [PERMISSIONS.saleCreate, PERMISSIONS.saleVoid]),
    canRefund: hasAnyPermission(user, [PERMISSIONS.saleCreate, PERMISSIONS.saleRefund]),
  });

  // The row menu's choice, once: Void / Refund open their dialog when the gate allows it
  // (otherwise the gate's message shows here); Reprint prints the receipt and shows its status.
  const reprintRef = useRef<HTMLElement>(null);
  const handled = useRef(false);
  const voidReady = gate.void?.enabled === true;
  const refundReady = gate.refund?.enabled === true;
  const gateSettled = !shift.loading;
  useEffect(() => {
    if (handled.current || intent === 'view' || !gateSettled) return;
    handled.current = true;
    if (intent === 'void' && voidReady) voiding.request();
    else if (intent === 'refund' && refundReady) refunding.request();
    else if (intent === 'reprint') {
      reprintRef.current?.scrollIntoView({ block: 'start' });
      void printing.reprint(order, 'receipt');
    }
  }, [intent, gateSettled, voidReady, refundReady, voiding, refunding, printing, order]);

  return (
    <div className="flex flex-col gap-5 text-[15px]">
      <div className="flex flex-wrap items-center gap-2">
        <OrderStatusBadge status={order.status} />
        {order.needs_review ? <NeedsReviewBadge /> : null}
        {order.source === 'offline' ? <Badge tone="outline">Offline sale {order.order_no ?? ''}</Badge> : null}
      </div>

      {gate.void || gate.refund || gate.notice ? (
        <section aria-label="Void or refund" className="flex flex-col gap-2">
          {gate.notice ? <p className="text-sm text-muted-foreground">{gate.notice}</p> : null}
          <div className="flex flex-wrap gap-2">
            {gate.void ? (
              <Button variant="destructive" onClick={voiding.request} disabled={!gate.void.enabled}>
                <BanIcon aria-hidden="true" />
                Void sale
              </Button>
            ) : null}
            {gate.refund ? (
              <Button variant="outline" onClick={refunding.request} disabled={!gate.refund.enabled}>
                <Undo2Icon aria-hidden="true" />
                Refund
              </Button>
            ) : null}
          </div>
          <ActionMessage action={gate.void} />
          <ActionMessage action={gate.refund} />
        </section>
      ) : null}

      <OrderReviewSection order={order} timezone={timezone} />

      <div className="grid grid-cols-2 gap-3 rounded-xl bg-subtle p-4">
        <div>
          <p className="text-[13px] text-muted-foreground">Queue</p>
          <p className="text-2xl font-bold tabular">#{order.queue_no}</p>
          {order.table_no ? <p className="text-sm font-semibold">Table {order.table_no}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-[13px] text-muted-foreground">Total</p>
          <p className="text-2xl font-bold text-green tabular">{formatPeso(order.total_cents)}</p>
          {order.customer ? <p className="text-sm">{order.customer.full_name}</p> : null}
        </div>
      </div>

      <section aria-label="Items" className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {order.items.map((item) => (
          <div key={item.id} className="flex flex-col gap-0.5 px-3 py-2.5">
            <div className="flex justify-between gap-3">
              <span className="font-medium">
                {item.qty} x {item.product_name}
              </span>
              <span className="tabular">{formatPeso(item.gross_cents)}</span>
            </div>
            {item.qty > 1 ? <span className="text-[13px] text-muted-foreground">{formatPeso(item.unit_price_cents)} each</span> : null}
            {item.discount && item.line_discount_cents > 0 ? (
              <div className="flex justify-between text-[13px] text-danger">
                <span>{describeDiscount(item.discount)}</span>
                <span className="tabular">-{formatPeso(item.line_discount_cents)}</span>
              </div>
            ) : null}
            {item.notes ? <span className="text-[13px] text-muted-foreground">Note: {item.notes}</span> : null}
            <div className="flex flex-wrap gap-1">
              {item.sc_pwd ? (
                <Badge tone="neutral">
                  SC/PWD
                </Badge>
              ) : null}
              {item.refunded_qty > 0 ? (
                <StatusBadge tone="info" label={`${item.refunded_qty} refunded`} />
              ) : null}
            </div>
          </div>
        ))}
      </section>

      <section aria-label="Totals" className="flex flex-col gap-1.5">
        <Line label="Subtotal" value={formatPeso(order.subtotal_cents)} />
        {regularDiscount > 0 ? (
          <Line
            label={order.order_discount ? `Discounts (order: ${describeDiscount(order.order_discount)})` : 'Discounts'}
            value={`-${formatPeso(regularDiscount)}`}
            tone="danger"
          />
        ) : null}
        {order.sc_pwd?.vat_exempt ? <Line label="VAT exempted (SC/PWD)" value={`-${formatPeso(order.sc_pwd.vat_relief_cents)}`} tone="danger" /> : null}
        {order.sc_pwd ? <Line label={SC_PWD_DISCOUNT_LABEL} value={`-${formatPeso(order.sc_pwd.discount_cents)}`} tone="danger" /> : null}
        {/* Dine-in Tables & Tabs §G/§I: a bill paid from a table may carry a service charge, outside the VAT figures. */}
        {order.service_charge_cents > 0 ? <Line label="Service charge" value={formatPeso(order.service_charge_cents)} /> : null}
        <Line label="Total" value={formatPeso(order.total_cents)} strong tone="green" />
        {order.split_count ? <Line label={`Split ${order.split_count} ways`} value={splitSharesText(order.total_cents, order.split_count)} tone="muted" /> : null}
        {order.payments.map((payment, index) => (
          <Line
            key={index}
            label={`${paymentMethodLabel(payment.method)}${payment.reference_no ? ` ${payment.reference_no}` : ''}`}
            value={formatPeso(payment.method === 'cash' ? (payment.tendered_cents ?? payment.amount_cents) : payment.amount_cents)}
            tone="muted"
          />
        ))}
        <Line label="Change" value={formatPeso(order.change_cents)} tone="muted" />
        {SHOW_VAT_BREAKDOWN ? (
          <>
            <Line label="VATable sales" value={formatPeso(order.vatable_sales_cents)} tone="muted" />
            <Line label={`VAT ${formatPercentValue(VAT_RATE_BPS)}`} value={formatPeso(order.vat_amount_cents)} tone="muted" />
            <Line label="VAT-exempt sales" value={formatPeso(order.vat_exempt_sales_cents)} tone="muted" />
          </>
        ) : null}
        {order.authorized_by ? <p className="text-[13px] text-muted-foreground">Discount approved by {order.authorized_by.name}</p> : null}
      </section>

      {order.sc_pwd ? (
        <section aria-label="Senior citizen or PWD" className="flex flex-col gap-1 rounded-lg border border-info-border bg-info-bg p-3 text-info">
          <p className="font-semibold">
            SC/PWD · {order.sc_pwd.mode === 'headcount' ? sharedMealLine(order.sc_pwd.diners ?? order.sc_pwd.persons.length, order.sc_pwd.persons.length) : scPwdModeLabel(order.sc_pwd.mode)}
          </p>
          {order.sc_pwd.persons.map((person) => (
            <p key={person.id_no} className="text-sm">
              {personTypeLabel(person.type)} · ID {person.id_no}
            </p>
          ))}
          <p className="text-sm">{order.sc_pwd.vat_exempt ? 'VAT exempt' : 'VAT not exempted'}</p>
        </section>
      ) : null}

      {order.status === 'voided' ? (
        <section aria-label="Void" className="rounded-lg border border-danger-border bg-danger-bg p-3 text-sm text-danger">
          <p className="font-semibold">Voided{order.voided_at ? ` ${formatBranchDateTime(order.voided_at, timezone) ?? ''}` : ''}</p>
          {order.voided_by ? <p>By {order.voided_by.name}{order.void_authorized_by ? `, approved by ${order.void_authorized_by.name}` : ''}</p> : null}
          {order.void_reason ? <p>Reason: {order.void_reason}</p> : null}
        </section>
      ) : null}

      {order.refunds.length > 0 ? (
        <section aria-label="Refunds" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Refunds · {formatPeso(order.refunded_cents)}</h3>
          {order.refunds.map((refund) => (
            <div key={refund.ulid} className="flex flex-col gap-0.5 rounded-lg border border-info-border bg-info-bg p-3 text-sm text-info">
              <p className="font-semibold">
                {formatPeso(refund.amount_cents)} · {formatBranchDateTime(refund.refunded_at, timezone) ?? refund.refunded_at}
              </p>
              <p>{refund.items.map((item) => `${item.qty} x ${item.product_name}`).join(', ')}</p>
              <p>{refund.payments.map(describeRefundPayment).join(' · ')}</p>
              <p>
                By {refund.refunded_by.name}
                {refund.authorized_by ? `, approved by ${refund.authorized_by.name}` : ''} · Reason: {refund.reason}
              </p>
            </div>
          ))}
        </section>
      ) : null}

      <section ref={reprintRef} aria-label="Reprint" className="flex flex-col gap-3 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">Reprint</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void printing.reprint(order, 'receipt')} disabled={printing.starting}>
            <PrinterIcon aria-hidden="true" />
            Receipt
          </Button>
          <Button variant="outline" onClick={() => void printing.reprint(order, 'kitchen')} disabled={printing.starting}>
            <PrinterIcon aria-hidden="true" />
            Kitchen tickets
          </Button>
          {order.status === 'voided' ? (
            <Button variant="outline" onClick={() => void printing.reprintVoidSlip(order)} disabled={printing.starting}>
              <PrinterIcon aria-hidden="true" />
              Void slip
            </Button>
          ) : null}
          {order.refunds.map((refund, index) => (
            <Button
              key={refund.ulid}
              variant="outline"
              onClick={() => void printing.printRefundSlip(order, refund, true)}
              disabled={printing.starting}
            >
              <PrinterIcon aria-hidden="true" />
              {order.refunds.length > 1 ? `Refund slip ${index + 1}` : 'Refund slip'}
            </Button>
          ))}
        </div>
        <PrintJobList tracker={printing.tracker} notices={printing.notices} unrouted={printing.unrouted} title="Reprint status" />
      </section>

      <VoidOrderDialog order={order} state={voiding} />
      <RefundDialog order={order} state={refunding} />
    </div>
  );
}

/** "Cash ₱33.69", "GCash ₱100.00 (1012345678901)". */
/** "₱94.24 / ₱94.23 / ₱94.23" (§E: share k = floor(total/N) + 1 centavo for k ≤ total mod N). */
function splitSharesText(totalCents: number, count: number): string {
  return equalSplitShares(totalCents, count)
    .map((share) => formatPeso(share))
    .join(' / ');
}

function describeRefundPayment(payment: Order['refunds'][number]['payments'][number]): string {
  const reference = payment.reference_no ? ` (${payment.reference_no})` : '';
  return `${paymentMethodLabel(payment.method)} ${formatPeso(payment.amount_cents)}${reference}`;
}
