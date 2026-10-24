/**
 * A purchase request (§F, §L): its number, status, requester, date needed and
 * remarks; the items with their supplier, quantity (and base quantity),
 * estimated price, and decision (reason, who, when); **Approve** / **Decline**
 * per pending item and **Approve all remaining** (`purchase.approve`; deciding
 * your own request without `purchase.approve_own` is refused by the server
 * with "Someone else must approve your own request."); **Edit** and **Cancel
 * request** while no item is decided; the link to its purchase order; and the
 * timeline.
 */
import { ArrowLeftIcon, CheckIcon, PencilIcon, PrinterIcon, XIcon } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { Banner } from '@/components/common/Banner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ErrorState, LoadingRows } from '@/components/common/ListStates';
import { PlainPage } from '@/components/common/PageBand';
import { ToneBadge } from '@/components/common/ToneBadge';
import { ReasonDialog } from '@/components/purchasing/ReasonDialog';
import { TimelineCard } from '@/components/purchasing/TimelineCard';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DECISION, PO_STATUS, PR_STATUS, SELF_APPROVAL_MESSAGE, statusFor } from '@/constants/purchasingLabels';
import { isUndecided, usePurchaseRequest, usePurchaseRequestActions } from '@/hooks/purchasing/usePurchaseRequests';
import { usePurchasingPermissions } from '@/hooks/purchasing/usePurchasingPermissions';
import type { PurchaseRequest } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatBranchDateTime } from '@pos/core/businessDay';
import { formatPeso } from '@pos/core/money';
import { formatQtyUnit, lineTotalCents } from '@pos/core/quantity';

export function PurchaseRequestDetailPage() {
  const params = useParams();
  const ulid = params.ulid ?? null;
  const detail = usePurchaseRequest(ulid);
  useShellHeader(detail.pr ? detail.pr.pr_no : 'Purchase request');

  return (
    <PlainPage
      title={detail.pr?.pr_no ?? 'Purchase request'}
      subtitle={detail.pr ? `Requested by ${detail.pr.requested_by.name}` : null}
      actions={
        <>
          {ulid && detail.pr ? (
            <Button asChild variant="outline">
              <Link to={`/purchasing/requests/${ulid}/print`} target="_blank" rel="noopener">
                <PrinterIcon aria-hidden="true" />
                Print / PDF
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link to="/purchasing/requests">
              <ArrowLeftIcon aria-hidden="true" />
              Purchase requests
            </Link>
          </Button>
        </>
      }
    >
      <div className="flex w-full max-w-[1100px] flex-col gap-4">
        {detail.loading ? (
          <Card>
            <LoadingRows rows={5} label="Loading the request…" />
          </Card>
        ) : detail.pr ? (
          <RequestBody pr={detail.pr} />
        ) : (
          <Card>
            <ErrorState title="Couldn't load the request" message={detail.error ?? 'Not found.'} onRetry={detail.reload} />
          </Card>
        )}
      </div>
    </PlainPage>
  );
}

function RequestBody({ pr }: { pr: PurchaseRequest }) {
  const permissions = usePurchasingPermissions();
  const actions = usePurchaseRequestActions(pr);
  const timezone = useSessionStore((state) => state.user?.branch.timezone ?? 'Asia/Manila');
  const own = pr.requested_by.id === permissions.userId;
  const canDecide = permissions.canApprove && pr.status === 'pending_approval';
  const canEdit = isUndecided(pr) && (permissions.canApprove || (own && permissions.canRequest));
  const busy = actions.busy !== null;

  return (
    <>
      {actions.banner && !actions.decline.state ? <Banner>{actions.banner}</Banner> : null}
      {own && canDecide && !permissions.canApproveOwn && actions.pendingCount > 0 ? (
        <Banner variant="info">This is your request. {SELF_APPROVAL_MESSAGE}</Banner>
      ) : null}

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <ToneBadge info={statusFor(PR_STATUS, pr.status)} />
            {pr.purchase_order ? (
              <Link to={`/purchasing/orders/${pr.purchase_order.ulid}`} className="text-sm font-medium text-green underline-offset-4 hover:underline">
                {pr.purchase_order.po_no} · {statusFor(PO_STATUS, pr.purchase_order.status).label}
              </Link>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit ? (
              <>
                <Button asChild variant="outline">
                  <Link to={`/purchasing/requests/${pr.ulid}/edit`}>
                    <PencilIcon aria-hidden="true" />
                    Edit
                  </Link>
                </Button>
                <Button variant="destructive" onClick={actions.cancelRequest.show} disabled={busy}>
                  Cancel request
                </Button>
              </>
            ) : null}
            {canDecide && actions.pendingCount > 0 ? (
              <Button variant="green" onClick={actions.approveAll.show} disabled={busy}>
                <CheckIcon aria-hidden="true" />
                Approve all remaining
              </Button>
            ) : null}
          </div>
        </div>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-[13px] text-muted-foreground">Created</dt>
            <dd className="font-medium">{formatBranchDateTime(pr.created_at, timezone) ?? pr.created_at}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted-foreground">Date needed</dt>
            <dd className="font-medium tabular">{pr.date_needed ?? 'Not set'}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted-foreground">Remarks</dt>
            <dd className="font-medium">{pr.remarks ?? '—'}</dd>
          </div>
        </dl>
      </Card>

      <Card className="overflow-hidden">
        <h2 className="border-b border-border px-5 py-4 text-base font-semibold">Items</h2>
        <div className="overflow-x-auto">
          <Table aria-label="Requested items">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Item</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Est. price</TableHead>
                <TableHead className="text-right">Est. total</TableHead>
                <TableHead>Decision</TableHead>
                {canDecide ? (
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pr.items.map((item) => {
                const estimate = item.estimated_unit_price_cents === null ? null : lineTotalCents(item.estimated_unit_price_cents, item.qty);
                const decision = statusFor(DECISION, item.decision);
                return (
                  <TableRow key={item.id} className="align-top hover:bg-transparent">
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{item.item.name}</span>
                        {item.remarks ? <span className="text-[13px] text-muted-foreground">{item.remarks}</span> : null}
                      </div>
                    </TableCell>
                    <TableCell>{item.supplier.name}</TableCell>
                    <TableCell className="text-right font-medium tabular">{formatQtyUnit(item.qty, item.unit)}</TableCell>
                    <TableCell className="text-right tabular">
                      {item.estimated_unit_price_cents === null ? '—' : `${formatPeso(item.estimated_unit_price_cents)} / ${item.unit}`}
                    </TableCell>
                    <TableCell className="text-right tabular">{estimate === null ? '—' : formatPeso(estimate)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <ToneBadge info={decision} />
                        {item.decision_reason ? <span className="text-[13px]">{item.decision_reason}</span> : null}
                        {item.decided_by ? (
                          <span className="text-[13px] text-muted-foreground">
                            {item.decided_by.name}
                            {item.decided_at ? ` · ${formatBranchDateTime(item.decided_at, timezone) ?? item.decided_at}` : ''}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    {canDecide ? (
                      <TableCell className="text-right">
                        {item.decision === 'pending' ? (
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="green" disabled={busy} onClick={() => actions.approve(item.id, item.item.name)} aria-label={`Approve ${item.item.name}`}>
                              <CheckIcon aria-hidden="true" />
                              {actions.busy === `approve-${item.id}` ? 'Approving…' : 'Approve'}
                            </Button>
                            <Button size="sm" variant="destructive" disabled={busy} onClick={() => actions.decline.open(item.id, item.item.name)} aria-label={`Decline ${item.item.name}`}>
                              <XIcon aria-hidden="true" />
                              Decline
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      <TimelineCard entries={pr.timeline ?? []} />

      <ReasonDialog
        open={actions.decline.state !== null}
        title="Decline item"
        description={actions.decline.state ? `Why is “${actions.decline.state.name}” declined? The requester sees the reason.` : ''}
        reason={actions.decline.state?.reason ?? ''}
        error={actions.decline.state?.error ?? null}
        banner={actions.decline.state ? actions.banner : null}
        busy={busy}
        confirmLabel="Decline item"
        onReason={actions.decline.setReason}
        onSubmit={actions.decline.submit}
        onClose={actions.decline.close}
      />
      <ConfirmDialog
        open={actions.approveAll.open}
        onClose={actions.approveAll.close}
        title="Approve all remaining"
        description={`Approve ${actions.pendingCount === 1 ? 'the 1 pending item' : `the ${actions.pendingCount} pending items`}? A purchase order is created for the approved items.`}
        confirmLabel="Approve all"
        pendingLabel="Approving…"
        pending={actions.busy === 'approve-all'}
        error={null}
        destructive={false}
        onConfirm={actions.approveAll.confirm}
      />
      <ConfirmDialog
        open={actions.cancelRequest.open}
        onClose={actions.cancelRequest.close}
        title="Cancel request"
        description={`${pr.pr_no} is cancelled. It stays on record and can't be reopened.`}
        confirmLabel="Cancel request"
        pendingLabel="Cancelling…"
        pending={actions.busy === 'cancel'}
        error={null}
        onConfirm={actions.cancelRequest.confirm}
      />
    </>
  );
}
