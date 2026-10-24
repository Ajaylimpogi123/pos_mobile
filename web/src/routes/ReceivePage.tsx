/**
 * Receive a purchase order (§H, §L; `purchase.receive`): per line the
 * ordered, received and remaining quantities, a quantity + unit entry (with
 * its base preview), a **Correction** switch (a negative receipt, which needs
 * a reason), the line's unit price, and a live status (Pending, Partial,
 * Complete, **Over-received** as a caution: over-receiving is allowed);
 * remarks; **Save receipt** (idempotent: the ULID is kept until the 201; a
 * timeout locks the entries and the button becomes **Retry**, which can't
 * count twice). The receipts history is on the order's page.
 */
import { ArrowLeftIcon, LoaderCircleIcon, RotateCwIcon } from 'lucide-react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FieldError, FormField } from '@/components/common/FormField';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/ListStates';
import { PlainPage } from '@/components/common/PageBand';
import { ToneBadge } from '@/components/common/ToneBadge';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { QtyUnitField } from '@/components/units/QtyUnitField';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { LINE_STATUS, PO_RECEIVING_STATUS, PO_STATUS, statusFor } from '@/constants/purchasingLabels';
import { usePurchaseOrder } from '@/hooks/purchasing/usePurchaseOrders';
import { usePurchasingPermissions } from '@/hooks/purchasing/usePurchasingPermissions';
import { lineField, RECEIVING_LIMITS, useReceiveForm, type ReceiveFormState } from '@/hooks/purchasing/useReceiving';
import type { PurchaseOrder, PurchaseOrderLine } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { formatQtyUnit } from '@pos/core/quantity';

export function ReceivePage() {
  const params = useParams();
  const ulid = params.ulid ?? null;
  const detail = usePurchaseOrder(ulid);
  const { canReceive } = usePurchasingPermissions();
  useShellHeader(detail.po ? `Receive ${detail.po.po_no}` : 'Receive');

  return (
    <PlainPage
      title={detail.po ? `Receive ${detail.po.po_no}` : 'Receive'}
      subtitle={detail.po ? `From ${detail.po.purchase_request.pr_no}` : null}
      actions={
        <>
          {detail.po ? (
            <Button asChild variant="outline">
              <Link to={`/purchasing/orders/${detail.po.ulid}`}>Order details</Link>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link to="/purchasing/receiving">
              <ArrowLeftIcon aria-hidden="true" />
              Receiving
            </Link>
          </Button>
        </>
      }
    >
      <div className="flex w-full max-w-[1100px] flex-col gap-4">
        {!canReceive ? (
          <EmptyState title="You don't have permission to receive" message="Ask a manager if you need access." />
        ) : detail.loading ? (
          <Card>
            <LoadingRows rows={5} label="Loading the order…" />
          </Card>
        ) : detail.po ? (
          <ReceiveForm key={detail.po.ulid} po={detail.po} />
        ) : (
          <Card>
            <ErrorState title="Couldn't load the order" message={detail.error ?? 'Not found.'} onRetry={detail.reload} />
          </Card>
        )}
      </div>
    </PlainPage>
  );
}

function ReceiveForm({ po }: { po: PurchaseOrder }) {
  const form = useReceiveForm(po);
  const approved = po.status === 'approved';
  const disabled = form.busy || form.locked || !approved;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    form.submit();
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={form.busy} className="flex flex-col gap-4">
      <ErrorSummary />
      {!approved ? <Banner variant="warning">Approve the order before receiving. It is {statusFor(PO_STATUS, po.status).label}.</Banner> : null}
      {form.banner ? <Banner>{form.banner}</Banner> : null}
      {form.unitsFailed ? <Banner variant="warning">Some units couldn't load. Reload the page to receive those lines.</Banner> : null}
      <FieldError message={form.errors.form} />

      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <ToneBadge info={statusFor(PO_STATUS, po.status)} />
          {approved ? <ToneBadge info={statusFor(PO_RECEIVING_STATUS, po.receiving_status)} /> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Expected {po.expected_delivery_date ?? 'any day'} · Total <span className="font-semibold text-green tabular">{formatPeso(po.total_cents)}</span>
        </p>
      </Card>

      {po.lines.map((line) => (
        <LineCard key={line.id} line={line} form={form} disabled={disabled} />
      ))}

      <Card className="flex flex-col gap-4 p-5">
        <FormField label="Remarks (optional)" error={form.errors.remarks}>
          <Textarea value={form.remarks} maxLength={RECEIVING_LIMITS.remarks} onChange={(event) => form.setRemarks(event.target.value)} disabled={disabled} />
        </FormField>
      </Card>

      <div className="sticky bottom-0 z-10 flex justify-end gap-2 rounded-xl border border-border bg-card p-3 shadow-card">
        <Button asChild variant="outline" size="lg">
          <Link to={`/purchasing/orders/${po.ulid}`}>Cancel</Link>
        </Button>
        <Button type="submit" variant="green" size="lg" disabled={form.busy || !approved}>
          {form.busy ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : form.locked ? <RotateCwIcon aria-hidden="true" /> : null}
          {form.busy ? 'Saving…' : form.locked ? 'Retry' : 'Save receipt'}
        </Button>
      </div>
    </form>
  );
}

function LineCard({ line, form, disabled }: { line: PurchaseOrderLine; form: ReceiveFormState; disabled: boolean }) {
  const entry = form.entryOf(line);
  const projection = form.project(line);
  const status = statusFor(LINE_STATUS, projection.status);
  const cost = form.costOf(line);
  const switchId = `receive-${line.id}-correction`;

  return (
    <Card className="flex flex-col gap-4 p-5" aria-label={line.item.name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{line.item.name}</h2>
          <p className="text-[13px] text-muted-foreground">
            {line.supplier.name} · {formatPeso(line.unit_price_cents)} / {line.unit}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1" aria-live="polite">
          <ToneBadge info={status} />
          {projection.changed ? <span className="text-[13px] text-muted-foreground">After this receipt</span> : null}
          {cost !== null ? <span className="text-sm font-semibold tabular">Cost {formatPeso(cost)}</span> : null}
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-subtle p-3 text-sm">
        <div>
          <dt className="text-[13px] text-muted-foreground">Ordered</dt>
          <dd className="font-semibold tabular">{formatQtyUnit(line.qty, line.unit)}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted-foreground">Received</dt>
          <dd className="font-semibold tabular">{formatQtyUnit(line.received_qty, line.unit)}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted-foreground">Remaining</dt>
          <dd className="font-semibold tabular">{formatQtyUnit(line.remaining_qty, line.unit)}</dd>
        </div>
      </dl>
      {projection.status === 'over_received' && projection.changed ? (
        <Banner variant="warning">This receives more than was ordered. That's allowed; the line shows as Over-received.</Banner>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <QtyUnitField
          label={entry.correction ? 'Quantity to remove' : 'Quantity received'}
          qty={entry.qty}
          unit={entry.unit}
          choices={form.choicesOf(line)}
          onQty={(qty) => form.setQty(line, qty)}
          onUnit={(unit) => form.setUnit(line, unit)}
          qtyError={form.errors[lineField(line.id, 'qty')]}
          unitError={form.errors[lineField(line.id, 'unit')]}
          disabled={disabled}
        />
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <Label htmlFor={switchId}>Correction</Label>
              <p className="text-[13px] text-muted-foreground">Removes quantity received by mistake.</p>
            </div>
            <Switch id={switchId} checked={entry.correction} onCheckedChange={(checked) => form.setCorrection(line, checked)} disabled={disabled} />
          </div>
          {entry.correction ? (
            <FormField label="Reason" error={form.errors[lineField(line.id, 'reason')]}>
              <Input value={entry.reason} maxLength={RECEIVING_LIMITS.reason} placeholder="e.g. Counted wrong" onChange={(event) => form.setReason(line, event.target.value)} disabled={disabled} />
            </FormField>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
