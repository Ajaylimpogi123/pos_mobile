/**
 * A purchase order (§G, §H, §L): its number, status, receiving status, the
 * request it came from, who created and approved it, the expected delivery,
 * remarks and total; the lines with their supplier, quantity, unit price,
 * total, received / remaining and line status (Over-received as a caution);
 * **Approve** / **Decline** (`purchase.approve` + self-approval), and while
 * pending, **Edit** per line and **Edit delivery** (`purchase.request` or
 * `purchase.approve`); **Receive** (`purchase.receive`) once approved; the
 * receipts history (append-only, newest first) and the timeline.
 */
import { ArrowLeftIcon, CheckIcon, PackageCheck, PencilIcon, PrinterIcon, XIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { FieldError, FormField } from '@/components/common/FormField';
import { ErrorState, LoadingRows } from '@/components/common/ListStates';
import { PlainPage } from '@/components/common/PageBand';
import { ToneBadge } from '@/components/common/ToneBadge';
import { SubmitContent } from '@/components/inventory/ProductStockDialogs';
import { SupplierPickerDialog } from '@/components/purchasing/PurchasePickers';
import { ReasonDialog } from '@/components/purchasing/ReasonDialog';
import { TimelineCard } from '@/components/purchasing/TimelineCard';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { QtyUnitField } from '@/components/units/QtyUnitField';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, MoneyInput, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LINE_STATUS, PO_RECEIVING_STATUS, PO_STATUS, SELF_APPROVAL_MESSAGE, statusFor } from '@/constants/purchasingLabels';
import { PO_LIMITS, usePurchaseOrder, usePurchaseOrderActions, type PurchaseOrderActionsState } from '@/hooks/purchasing/usePurchaseOrders';
import { usePurchasingPermissions } from '@/hooks/purchasing/usePurchasingPermissions';
import type { PurchaseOrder } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatBranchDateTime } from '@pos/core/businessDay';
import { formatPeso } from '@pos/core/money';
import { formatQtyUnit } from '@pos/core/quantity';

export function PurchaseOrderDetailPage() {
  const params = useParams();
  const ulid = params.ulid ?? null;
  const detail = usePurchaseOrder(ulid);
  useShellHeader(detail.po ? detail.po.po_no : 'Purchase order');

  return (
    <PlainPage
      title={detail.po?.po_no ?? 'Purchase order'}
      subtitle={detail.po ? `From ${detail.po.purchase_request.pr_no}` : null}
      actions={
        <>
          {ulid && detail.po ? (
            <Button asChild variant="outline">
              <Link to={`/purchasing/orders/${ulid}/print`} target="_blank" rel="noopener">
                <PrinterIcon aria-hidden="true" />
                Print / PDF
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link to="/purchasing/orders">
              <ArrowLeftIcon aria-hidden="true" />
              Purchase orders
            </Link>
          </Button>
        </>
      }
    >
      <div className="flex w-full max-w-[1100px] flex-col gap-4">
        {detail.loading ? (
          <Card>
            <LoadingRows rows={5} label="Loading the order…" />
          </Card>
        ) : detail.po ? (
          <OrderBody po={detail.po} />
        ) : (
          <Card>
            <ErrorState title="Couldn't load the order" message={detail.error ?? 'Not found.'} onRetry={detail.reload} />
          </Card>
        )}
      </div>
    </PlainPage>
  );
}

function OrderBody({ po }: { po: PurchaseOrder }) {
  const permissions = usePurchasingPermissions();
  const actions = usePurchaseOrderActions(po);
  const timezone = useSessionStore((state) => state.user?.branch.timezone ?? 'Asia/Manila');
  const pending = po.status === 'pending_approval';
  const canDecide = pending && permissions.canApprove;
  const canEdit = pending && (permissions.canRequest || permissions.canApprove);
  const canReceive = po.status === 'approved' && po.receiving_status !== 'fully_received' && permissions.canReceive;
  const own = po.created_by?.id === permissions.userId;
  const busy = actions.busy !== null;
  const when = (iso: string | null) => (iso ? (formatBranchDateTime(iso, timezone) ?? iso) : null);
  const lineName = new Map(po.lines.map((line) => [line.id, line.item.name]));

  return (
    <>
      {actions.banner && !actions.decline.state ? <Banner>{actions.banner}</Banner> : null}
      {own && canDecide && !permissions.canApproveOwn ? <Banner variant="info">You created this order. {SELF_APPROVAL_MESSAGE}</Banner> : null}

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <ToneBadge info={statusFor(PO_STATUS, po.status)} />
            {po.status === 'approved' ? <ToneBadge info={statusFor(PO_RECEIVING_STATUS, po.receiving_status)} /> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit ? (
              <Button variant="outline" onClick={actions.delivery.show} disabled={busy}>
                <PencilIcon aria-hidden="true" />
                Edit delivery
              </Button>
            ) : null}
            {canDecide ? (
              <>
                <Button variant="destructive" onClick={actions.decline.show} disabled={busy}>
                  <XIcon aria-hidden="true" />
                  Decline
                </Button>
                <Button variant="green" onClick={actions.approve.show} disabled={busy}>
                  <CheckIcon aria-hidden="true" />
                  Approve
                </Button>
              </>
            ) : null}
            {canReceive ? (
              <Button asChild variant="green">
                <Link to={`/purchasing/receiving/${po.ulid}`}>
                  <PackageCheck aria-hidden="true" />
                  Receive
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
        {po.decline_reason ? <Banner variant="warning" title="Declined">{po.decline_reason}</Banner> : null}
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-[13px] text-muted-foreground">Request</dt>
            <dd>
              <Link to={`/purchasing/requests/${po.purchase_request.ulid}`} className="font-medium text-green underline-offset-4 hover:underline">
                {po.purchase_request.pr_no}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted-foreground">Created by</dt>
            <dd className="font-medium">{po.created_by?.name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted-foreground">Approved</dt>
            <dd className="font-medium">{po.approved_by ? `${po.approved_by.name} · ${when(po.approved_at) ?? ''}` : '—'}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted-foreground">Expected delivery</dt>
            <dd className="font-medium tabular">{po.expected_delivery_date ?? 'Not set'}</dd>
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="text-[13px] text-muted-foreground">Remarks</dt>
            <dd className="font-medium">{po.remarks ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted-foreground">Total</dt>
            <dd className="text-xl font-bold text-green tabular">{formatPeso(po.total_cents)}</dd>
          </div>
        </dl>
      </Card>

      <Card className="overflow-hidden">
        <h2 className="border-b border-border px-5 py-4 text-base font-semibold">Lines</h2>
        <div className="overflow-x-auto">
          <Table aria-label="Order lines">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Item</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Ordered</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead>Status</TableHead>
                {canEdit ? (
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.lines.map((line) => (
                <TableRow key={line.id} className="align-top hover:bg-transparent">
                  <TableCell className="font-medium">{line.item.name}</TableCell>
                  <TableCell>{line.supplier.name}</TableCell>
                  <TableCell className="text-right tabular">{formatQtyUnit(line.qty, line.unit)}</TableCell>
                  <TableCell className="text-right tabular">
                    {line.unit_price_cents === 0 ? <span className="text-warning">Not set</span> : `${formatPeso(line.unit_price_cents)} / ${line.unit}`}
                  </TableCell>
                  <TableCell className="text-right tabular">{formatPeso(line.line_total_cents)}</TableCell>
                  <TableCell className="text-right tabular">
                    <div className="flex flex-col items-end">
                      <span>{formatQtyUnit(line.received_qty, line.unit)}</span>
                      <span className="text-[13px] text-muted-foreground">Remaining {formatQtyUnit(line.remaining_qty, line.unit)}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <ToneBadge info={statusFor(LINE_STATUS, line.receiving_status)} />
                  </TableCell>
                  {canEdit ? (
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => actions.line.show(line)} disabled={busy} aria-label={`Edit ${line.item.name}`}>
                        <PencilIcon aria-hidden="true" />
                        Edit
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-base font-semibold">Receipts</h2>
        {po.receipts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing received yet.</p>
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Receipts">
            {po.receipts.map((receipt) => (
              <li key={receipt.ulid} className="rounded-lg border border-border p-3">
                <p className="font-medium">
                  {receipt.received_by?.name ?? 'Received'} · {when(receipt.received_at)}
                </p>
                {receipt.remarks ? <p className="text-sm text-muted-foreground">{receipt.remarks}</p> : null}
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {receipt.lines.map((line, index) => (
                    <li key={`${receipt.ulid}-${line.po_line_id}-${index}`} className="flex flex-wrap justify-between gap-2 tabular">
                      <span>
                        {lineName.get(line.po_line_id) ?? `Line ${line.po_line_id}`}: {formatQtyUnit(line.qty, line.unit)}
                        {line.reason ? <span className="text-muted-foreground"> · Correction: {line.reason}</span> : null}
                      </span>
                      <span>{formatPeso(line.cost_cents)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <TimelineCard entries={po.timeline} />

      <ConfirmDialog
        open={actions.approve.open}
        onClose={actions.approve.close}
        title="Approve order"
        description={`Approve ${po.po_no} for ${formatPeso(po.total_cents)}? It becomes ready for receiving.`}
        confirmLabel="Approve"
        pendingLabel="Approving…"
        pending={actions.busy === 'approve'}
        error={null}
        destructive={false}
        onConfirm={actions.approve.confirm}
      />
      <ReasonDialog
        open={actions.decline.state !== null}
        title="Decline order"
        description={`Why is ${po.po_no} declined?`}
        reason={actions.decline.state?.reason ?? ''}
        error={actions.decline.state?.error ?? null}
        banner={actions.decline.state ? actions.banner : null}
        busy={busy}
        confirmLabel="Decline order"
        onReason={actions.decline.setReason}
        onSubmit={actions.decline.submit}
        onClose={actions.decline.close}
      />
      <LineEditDialog actions={actions} />
      <DeliveryDialog actions={actions} />
    </>
  );
}

function LineEditDialog({ actions }: { actions: PurchaseOrderActionsState }) {
  const edit = actions.line.state;
  const [picking, setPicking] = useState(false);
  const busy = actions.busy === 'line';

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    actions.line.save();
  }

  return (
    <>
      <Dialog open={edit !== null && !picking} onOpenChange={(open) => (open ? null : actions.line.close())}>
        <DialogContent hideClose={busy}>
          <DialogHeader>
            <DialogTitle>Edit line</DialogTitle>
            <DialogDescription>{edit ? edit.line.item.name : ''}</DialogDescription>
          </DialogHeader>
          {edit ? (
            <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate aria-busy={busy}>
              <ErrorSummary />
              {actions.line.banner ? <Banner>{actions.line.banner}</Banner> : null}
              <QtyUnitField
                label="Quantity"
                qty={edit.qty}
                unit={edit.unit}
                choices={actions.line.choices}
                onQty={(qty) => actions.line.set({ qty })}
                onUnit={(unit) => actions.line.set({ unit })}
                qtyError={edit.errors.qty}
                unitError={edit.errors.unit}
                disabled={busy}
              />
              <FormField label={`Unit price per ${edit.unit}`} error={edit.errors.price}>
                <MoneyInput value={edit.price} placeholder="0.00" onChange={(event) => actions.line.set({ price: event.target.value })} disabled={busy} />
              </FormField>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="po-line-supplier">Supplier</Label>
                <Button id="po-line-supplier" type="button" variant="outline" className="h-10 justify-start" onClick={() => setPicking(true)} disabled={busy}>
                  {edit.supplier.name}
                </Button>
                <FieldError message={edit.errors.supplier} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={actions.line.close} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" variant="green" size="lg" disabled={busy || !actions.line.choices}>
                  <SubmitContent busy={busy} locked={false} label="Save line" />
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
      <SupplierPickerDialog open={edit !== null && picking} onClose={() => setPicking(false)} onPick={(supplier) => actions.line.set({ supplier })} />
    </>
  );
}

function DeliveryDialog({ actions }: { actions: PurchaseOrderActionsState }) {
  const delivery = actions.delivery.state;
  const busy = actions.busy === 'delivery';

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    actions.delivery.save();
  }

  return (
    <Dialog open={delivery !== null} onOpenChange={(open) => (open ? null : actions.delivery.close())}>
      <DialogContent hideClose={busy}>
        <DialogHeader>
          <DialogTitle>Delivery details</DialogTitle>
          <DialogDescription>The expected delivery date and remarks of this order.</DialogDescription>
        </DialogHeader>
        {delivery ? (
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate aria-busy={busy}>
            <ErrorSummary />
            {actions.delivery.banner ? <Banner>{actions.delivery.banner}</Banner> : null}
            <FormField label="Expected delivery (optional)" error={delivery.errors.date} className="max-w-[240px]">
              <Input type="date" value={delivery.date} onChange={(event) => actions.delivery.setDate(event.target.value)} disabled={busy} />
            </FormField>
            <FormField label="Remarks (optional)" error={delivery.errors.remarks}>
              <Textarea value={delivery.remarks} maxLength={PO_LIMITS.remarks} onChange={(event) => actions.delivery.setRemarks(event.target.value)} disabled={busy} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={actions.delivery.close} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" variant="green" size="lg" disabled={busy}>
                <SubmitContent busy={busy} locked={false} label="Save" />
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
